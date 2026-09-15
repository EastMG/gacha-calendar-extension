// Chromium 运行时验证（**必须在普通桌面环境运行**，不要在有文件沙箱的受限环境里跑）。
//
// 这个脚本做一件事：加载 dist/ 扩展 → 让扩展的 service worker 自己跑一遍自检
// （11 款实抓 + 直连/代发两条通道 + 面板渲染模型）→ 把报告写进 chrome.storage.local
// → 从 profile 的 LevelDB 里读回来断言。
//
// 为什么不用 CDP：部分受限环境下 Node 内置 WebSocket 与 Chrome DevTools 协议层不通
// （能握手、命令零响应）。而 service worker 一定会随扩展加载启动，写 storage 又不需要网络，
// 所以这条通路更稳。
//
// 用法：
//   node tools/verify-chromium.mjs                 # 用环境变量 CHROME_PATH 或默认路径
//   CHROME_PATH=/path/to/chrome node tools/verify-chromium.mjs
//
// 需要先 `node build.mjs`。脚本会自动执行 `node build.mjs --verify` 产出带自检的扩展。
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const PROFILE = path.join(ROOT, "_chromium-profile");
const PORT = 9371;

const CANDIDATES = [
	process.env.CHROME_PATH,
	process.env.EDGE_PATH,
	"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
	"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
	process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Google\\Chrome\\Application\\chrome.exe") : null,
	"/usr/bin/google-chrome",
	"/usr/bin/chromium"
].filter(Boolean);
const BROWSER = CANDIDATES.find((p) => fs.existsSync(p));

const log = [];
const say = (...a) => {
	const line = a.join(" ");
	log.push(line);
	console.log(line);
};
let failed = 0;
const check = (name, ok, detail = "") => {
	say(`  ${ok ? "✓" : "✗"} ${name}${detail ? "  " + detail : ""}`);
	if (!ok) failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function countFiles(dir) {
	let n = 0;
	try {
		for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
			const p = path.join(dir, e.name);
			if (e.isDirectory()) n += countFiles(p);
			else n++;
		}
	} catch {}
	return n;
}

/** 从 profile 的扩展存储 LevelDB 里把自检报告挖出来。 */
function readReport(profileDir) {
	const base = path.join(profileDir, "Default", "Local Extension Settings");
	if (!fs.existsSync(base)) return { error: "没有 Local Extension Settings（扩展没写出过 storage）" };
	const blobs = [];
	for (const id of fs.readdirSync(base)) {
		const dir = path.join(base, id);
		if (!fs.statSync(dir).isDirectory()) continue;
		for (const f of fs.readdirSync(dir)) {
			if (/\.(log|ldb)$/.test(f)) blobs.push(fs.readFileSync(path.join(dir, f)));
		}
	}
	if (blobs.length === 0) return { error: "存储目录为空" };

	for (const buf of blobs) {
		for (const enc of ["utf8", "utf16le"]) {
			const text = buf.toString(enc);
			let idx = text.indexOf('"where":"service_worker"');
			if (idx < 0) idx = text.indexOf('\\"where\\":\\"service_worker\\"');
			if (idx < 0) continue;
			let start = text.lastIndexOf("{", idx);
			if (start < 0) continue;
			// 括号配对截出完整 JSON
			let depth = 0, end = -1, inStr = false, esc = false;
			for (let i = start; i < text.length; i++) {
				const ch = text[i];
				if (inStr) {
					if (esc) esc = false;
					else if (ch === "\\") esc = true;
					else if (ch === '"') inStr = false;
					continue;
				}
				if (ch === '"') inStr = true;
				else if (ch === "{") depth++;
				else if (ch === "}") {
					depth--;
					if (depth === 0) {
						end = i + 1;
						break;
					}
				}
			}
			if (end < 0) continue;
			const raw = text.slice(start, end);
			for (const candidate of [raw, raw.replace(/\\"/g, '"').replace(/\\\\/g, "\\")]) {
				try {
					return { report: JSON.parse(candidate), encoding: enc, blobs: blobs.length };
				} catch {}
			}
		}
	}
	return { error: "在 LevelDB 里没找到报告", blobs: blobs.length };
}

async function main() {
	say("=== 0. 准备 ===");
	if (!BROWSER) {
		say("✗ 没找到 Chromium 系浏览器。用 CHROME_PATH 指定路径后重试。");
		process.exit(1);
	}
	say(`  浏览器: ${BROWSER}`);
	execFileSync(process.execPath, ["build.mjs", "--verify"], { cwd: ROOT, stdio: "inherit" });
	const bgSize = fs.statSync(path.join(DIST, "background.js")).size;
	say(`  background.js = ${bgSize} B（含自检；正常构建里没有它）`);

	say("\n=== 1. 启动浏览器并加载扩展 ===");
	fs.rmSync(PROFILE, { recursive: true, force: true });
	const outFd = fs.openSync(path.join(ROOT, "_chromium-out.txt"), "w");
	const child = spawn(
		BROWSER,
		[
			`--user-data-dir=${PROFILE}`,
			`--load-extension=${DIST}`,
			`--disable-extensions-except=${DIST}`,
			`--remote-debugging-port=${PORT}`,
			"--no-first-run",
			"--no-default-browser-check",
			"about:blank"
		],
		{ stdio: ["ignore", outFd, outFd] }
	);
	say(`  pid ${child.pid}`);

	// 等扩展加载并跑完自检
	let extId = null;
	let lastSeen = -1;
	const deadline = Date.now() + 180000;
	while (Date.now() < deadline) {
		await sleep(3000);
		if (!extId) {
			try {
				const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
				const sw = list.find((t) => t.type === "service_worker" && t.url.startsWith("chrome-extension://"));
				if (sw) {
					extId = new URL(sw.url).host;
					say(`  扩展 ID: ${extId}`);
				}
			} catch {}
		}
		if (extId) {
			const dir = path.join(PROFILE, "Default", "Local Extension Settings", extId);
			const n = fs.existsSync(dir) ? countFiles(dir) : 0;
			if (n !== lastSeen) {
				say(`    storage 文件数 = ${n}`);
				lastSeen = n;
			}
			if (n > 0) break;
		}
	}

	try { child.kill(); } catch {}
	await sleep(2500);
	fs.closeSync(outFd);

	say("\n=== 2. 读取报告 ===");
	const got = readReport(PROFILE);
	if (!got.report) {
		check("service worker 执行并写出报告", false, got.error);
		say("  看 _chromium-out.txt 里的浏览器错误；常见原因：受限沙箱挡住了 Chrome 子进程。");
	} else {
		say(`  （${got.encoding} 编码，扫描 ${got.blobs} 个 LevelDB 文件）`);
		const s = got.report.steps || {};

		const env = s.env || {};
		check("service worker 读到 manifest", env.ok === true && env.manifestVersion === 3, `${env.name} v${env.version}`);
		check("chrome.storage 可用", env.hasStorage === true);
		check("host_permissions 生效", env.hostCount >= 24, `${env.hostCount} 条`);

		check("listGames 返回 11 款", !!(s.listGames && s.listGames.ok), s.listGames ? `${s.listGames.count} 款` : "无");
		check("直连通道可用", !!(s.rawOk && s.rawOk.ok), s.rawOk ? `HTTP ${s.rawOk.status}, ${s.rawOk.len} B` : JSON.stringify(s.rawOk));
		check("代发通道可用（经 background 跨域）", !!(s.proxyOk && s.proxyOk.ok), s.proxyOk ? `${s.proxyOk.len} B` : JSON.stringify(s.proxyOk));

		const r = s.refresh || {};
		check("真抓覆盖 11 款", r.ok === true, `${r.total} 款，${((r.elapsedMs || 0) / 1000).toFixed(1)}s`);
		check("契约字段齐全", r.schemaVersion === 1 && r.parserVersionCount === 11, `v${r.schemaVersion}, ${r.parserVersionCount} 项`);
		// bwiki 会风控（HTTP 567），所以阈值放宽；非 bwiki 源应全部成功
		check("卡池有内容 ≥ 5 款", r.gacha >= 5, `${r.gacha}/11`);
		check("活动有内容 ≥ 5 款", r.event >= 5, `${r.event}/11`);

		const rows = (s.rows && s.rows.rows) || [];
		check("面板渲染模型算出 11 行", rows.length === 11, `${rows.length} 行`);
		check("起止列出现倒计时", rows.some((x) => /还剩|还有|已结束/.test(x.gachaDates || "")), "");
		check("顶部提示已生成", /成功\s+\d+\/11/.test((s.scrapeInfo && s.scrapeInfo.info) || ""), (s.scrapeInfo && s.scrapeInfo.info) || "");
		if (rows.length) {
			say("  逐行：");
			for (const x of rows) say(`    ${x.name.padEnd(16)} 卡池=${(x.gacha || "").slice(0, 20).padEnd(20)} 活动=${(x.event || "").slice(0, 16).padEnd(16)} ${x.gachaDates || ""} ${x.badge || ""}`);
		}
	}

	fs.writeFileSync(path.join(ROOT, "_chromium-verify.txt"), log.join("\n") + "\n", "utf8");
	try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {}

	say("");
	if (failed) {
		say(`✗ ${failed} 项未通过`);
		process.exit(1);
	}
	say("✓ Chromium 运行时验证通过");
}

main().catch((e) => {
	say("✗ 脚本异常: " + String((e && e.stack) || e));
	fs.writeFileSync(path.join(ROOT, "_chromium-verify.txt"), log.join("\n") + "\n", "utf8");
	process.exit(1);
});
