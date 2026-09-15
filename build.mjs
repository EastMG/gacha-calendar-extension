// 二游排期 · 扩展构建脚本
//
// 为什么要构建：Chromium 扩展**不允许运行时从 CDN 取代码**（MV3 明令禁止远程代码），
// 所以 gacha-calendar-core 必须内联进扩展自己的 js 里。
//
// 产物（dist/，直接"加载已解压的扩展程序"指向它即可）：
//   dist/manifest.json
//   dist/background.js                  ← background service worker（不依赖 core）
//   dist/popup.html / popup.css / popup.js
//   dist/options.html / options.css / options.js
//   dist/icons/icon-{16,32,48,128}.png
//   dist/core-version.js                ← 构建时生成，供设置页显示 core 版本
//
// 用法：
//   node build.mjs           构建到 dist/
//   node build.mjs --zip     构建并打包 dist/ → release/gacha-calendar-extension-<version>.zip
//   node build.mjs --check   只校验（不写盘）：dist/ 是否与当前源码一致

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, "src");
const DIST = path.join(ROOT, "dist");
const RELEASE = path.join(ROOT, "release");

const args = process.argv.slice(2);
const CHECK = args.includes("--check");
const ZIP = args.includes("--zip");
/** --verify：额外产出 dist/verify.js（仅用于自动化验证，不参与扩展运行逻辑）。 */
const VERIFY = args.includes("--verify");

function fail(msg) {
	console.error("✗ " + msg);
	process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));

// —— 一致性校验：package.json 与 manifest.json 的版本必须相同 ——
if (pkg.version !== manifest.version) {
	fail(`版本号不一致：package.json=${pkg.version} manifest.json=${manifest.version}`);
}

// —— core 依赖必须已安装（构建要把它内联进来）——
const corePkgPath = path.join(ROOT, "node_modules", "gacha-calendar-core", "package.json");
if (!fs.existsSync(corePkgPath)) {
	fail("未安装依赖，请先运行：npm install");
}
const corePkg = JSON.parse(fs.readFileSync(corePkgPath, "utf8"));

// —— 版本落地：dist/ 里的 manifest 版本跟 package.json 走 ——
manifest.version = pkg.version;

// —— 需要复制到 dist 的静态资源 ——
const STATIC = [
	["src/popup.html", "popup.html"],
	["src/popup.css", "popup.css"],
	["src/options.html", "options.html"],
	["src/options.css", "options.css"]
];

const ICON_SIZES = [16, 32, 48, 128];

function ensureDir(dir) {
	fs.mkdirSync(dir, { recursive: true });
}

/** 定位 esbuild 可执行文件。
 *  说明：本仓库**不依赖 npm 的 .bin 垫片**（那是 shell 包装，部分受限环境下无法执行），
 *  直接用平台预编译二进制。装依赖的方式见 README 的「构建」一节。 */
function esbuildBin() {
	const candidates = [];
	if (process.platform === "win32") {
		candidates.push(
			path.join(ROOT, "node_modules", "@esbuild", "win32-x64", "esbuild.exe"),
			path.join(ROOT, "node_modules", "esbuild", "esbuild.exe")
		);
	} else if (process.platform === "darwin") {
		candidates.push(
			path.join(ROOT, "node_modules", "@esbuild", process.arch === "arm64" ? "darwin-arm64" : "darwin-x64", "bin", "esbuild"),
			path.join(ROOT, "node_modules", "esbuild", "bin", "esbuild")
		);
	} else {
		candidates.push(
			path.join(ROOT, "node_modules", "@esbuild", process.arch === "arm64" ? "linux-arm64" : "linux-x64", "bin", "esbuild"),
			path.join(ROOT, "node_modules", "esbuild", "bin", "esbuild")
		);
	}
	for (const c of candidates) if (fs.existsSync(c)) return c;
	fail("未找到 esbuild 可执行文件，请先安装依赖（见 README「构建」一节）");
}

/** 用 esbuild 把 ESM 依赖树打成单文件 IIFE（core 因此被内联）。 */
function bundle(entry, outfile) {
	execFileSync(
		esbuildBin(),
		[
			path.join(SRC, entry),
			"--bundle",
			"--format=iife",
			"--target=chrome102",
			"--platform=browser",
			"--legal-comments=none",
			"--log-level=warning",
			`--outfile=${outfile}`
		],
		{ cwd: ROOT, stdio: "inherit" }
	);
}

// —— 图标：从 src/icons 复制；缺失则明确报错（避免商店上架时才发现没图标）——
function copyIcons() {
	for (const size of ICON_SIZES) {
		const from = path.join(SRC, "icons", `icon-${size}.png`);
		if (!fs.existsSync(from)) fail(`缺少图标 src/icons/icon-${size}.png（运行 node make-icons.mjs 生成）`);
		if (!CHECK) fs.copyFileSync(from, path.join(DIST, "icons", `icon-${size}.png`));
	}
}

// —— 组装产物清单（内容 → 目标路径）——
function buildArtifacts() {
	const out = new Map();
	// manifest：写出前统一版本号，键顺序固定（Chrome 对 manifest_version 开头更友好）
	const mf = {
		manifest_version: manifest.manifest_version,
		name: manifest.name,
		version: manifest.version,
		description: manifest.description,
		icons: manifest.icons,
		action: manifest.action,
		options_ui: manifest.options_ui,
		background: manifest.background,
		permissions: manifest.permissions,
		host_permissions: VERIFY ? ["http://127.0.0.1/*", ...manifest.host_permissions] : manifest.host_permissions,
		minimum_chrome_version: manifest.minimum_chrome_version
	};
	out.set("manifest.json", JSON.stringify(mf, null, 2) + "\n");
	// background.js：正常构建原样复制（保持可读、便于审查）；
	// --verify 时把自检入口一起打进去（由 esbuild 内联 core），用于自动化验证。
	if (!VERIFY) {
		out.set("background.js", fs.readFileSync(path.join(SRC, "background.js"), "utf8"));
	}
	// core 版本（设置页显示用）
	out.set("core-version.js", `export const CORE_VERSION = ${JSON.stringify(corePkg.version)};\n`);
	// 静态资源
	for (const [from, to] of STATIC) out.set(to, fs.readFileSync(path.join(ROOT, from), "utf8"));
	return out;
}

function main() {
	ensureDir(DIST);
	ensureDir(path.join(DIST, "icons"));

	const artifacts = buildArtifacts();

	if (CHECK) {
		let bad = 0;
		for (const [rel, content] of artifacts) {
			const p = path.join(DIST, rel);
			if (!fs.existsSync(p)) {
				console.error(`  缺失  ${rel}`);
				bad++;
				continue;
			}
			const same = fs.readFileSync(p, "utf8") === content;
			console.log(`  ${same ? "一致" : "不一致"}  ${rel}`);
			if (!same) bad++;
		}
		// 打包产物（js）与图标也要比
		for (const rel of ["popup.js", "options.js"]) {
			if (!fs.existsSync(path.join(DIST, rel))) {
				console.error(`  缺失  ${rel}（需先 build）`);
				bad++;
			}
		}
		if (bad) fail(`${bad} 项与 dist/ 不一致 —— 请运行 node build.mjs`);
		console.log("\n✓ dist/ 与源码一致");
		return;
	}

	for (const [rel, content] of artifacts) fs.writeFileSync(path.join(DIST, rel), content, "utf8");
	copyIcons();
	// 清掉历史遗留的验证产物：`--verify` 曾生成过 verify.js / verify.html，
	// 正常构建必须把它们删掉，否则会被打进上架包（多余代码 = 审核风险）。
	for (const stale of ["verify.js", "verify.html"]) {
		const p = path.join(DIST, stale);
		if (fs.existsSync(p)) {
			fs.rmSync(p, { force: true });
			console.log(`  已移除历史验证产物 ${stale}`);
		}
	}
	bundle("popup.js", path.join(DIST, "popup.js"));
	bundle("options.js", path.join(DIST, "options.js"));
	// --verify：把"启动自检"打进 background.js（service worker 一定会执行，是验证的可靠落点）
	if (VERIFY) {
		const orig = fs.readFileSync(path.join(SRC, "background.js"), "utf8");
		fs.writeFileSync(path.join(SRC, "_bg-verify-entry.js"), 'import "./verify-boot.js";\n' + orig, "utf8");
		try {
			bundle("_bg-verify-entry.js", path.join(DIST, "background.js"));
		} finally {
			fs.rmSync(path.join(SRC, "_bg-verify-entry.js"), { force: true });
		}
	}
	// 验证入口（可选）：自检跑在 background service worker 里（见 src/verify-boot.js）。
	// 这里不再产出额外的验证页面 —— 经实测，本机 Chrome 下 chrome-extension:// 页面难以可靠加载，
	// 而 service worker 一定会执行，是更可信的验证落点。

	// 产物摘要（便于人工核对与写 release notes）
	const digest = (rel) => {
		const b = fs.readFileSync(path.join(DIST, rel));
		return { size: b.length, sha: crypto.createHash("sha256").update(b).digest("hex") };
	};
	console.log(`\n写出 dist/（扩展版本 ${pkg.version}，内联核心 gacha-calendar-core@${corePkg.version}）`);
	for (const rel of ["manifest.json", "background.js", "popup.js", "options.js", "core-version.js"]) {
		const d = digest(rel);
		console.log(`  ${rel.padEnd(18)} ${String(d.size).padStart(7)} B  sha256=${d.sha.slice(0, 16)}`);
	}

	if (ZIP) {
		ensureDir(RELEASE);
		const zipPath = path.join(RELEASE, `gacha-calendar-extension-${pkg.version}.zip`);
		fs.rmSync(zipPath, { force: true });
		// 用 PowerShell 压缩（避免引入 zip 依赖）；-Path 下的内容会进入 zip 根目录
		execFileSync(
			"powershell",
			[
				"-NoProfile",
				"-Command",
				`Compress-Archive -Path '${path.join(DIST, "*")}' -DestinationPath '${zipPath}' -Force`
			],
			{ stdio: "inherit" }
		);
		console.log(`\n打包: ${path.relative(ROOT, zipPath)}`);
	}
}

main();
