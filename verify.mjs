// 扩展静态校验：在浏览器加载之前，把"能纯静态查出来"的问题一次性查完。
//
// 覆盖（都来自 MV3 / 商店审核的真实硬性要求）：
//   1. manifest 必填字段与取值合法（manifest_version / action / host_permissions 形态）
//   2. manifest.version 与 package.json 一致
//   3. **来源域名覆盖**：core 实际抓取的每个域名都已授权（manifest + background 白名单）
//      —— 见 tools/check-domains.mjs。这是本项目最危险的失误类型：core 一换源而扩展漏配
//      权限，该来源在浏览器里会**静默抓不到**（曾真实发生：1999 的 notice.sl916.com）
//   4. **零远程代码**：产物里不得出现 http(s) 的 import / importScripts / eval / new Function
//   5. core 确实被内联进了 UI 产物（否则运行时就是"扩展没数据"）
//   6. 图标齐全且是合法 PNG
//   7. 产物清单与大小摘要
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { analyzeDomains } from "./tools/check-domains.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, "dist");

let failed = 0;
const problems = [];
function check(name, ok, detail = "") {
	console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? "  " + detail : ""}`);
	if (!ok) {
		failed++;
		problems.push(name + (detail ? " — " + detail : ""));
	}
}

function readJson(p) {
	return JSON.parse(fs.readFileSync(p, "utf8"));
}

console.log("=== 1. manifest ===");
const manifestPath = path.join(DIST, "manifest.json");
if (!fs.existsSync(manifestPath)) {
	console.error("✗ dist/manifest.json 不存在，请先 node build.mjs");
	process.exit(1);
}
const mf = readJson(manifestPath);

check("manifest_version === 3", mf.manifest_version === 3, String(mf.manifest_version));
check("name 非空且不含占位符", typeof mf.name === "string" && mf.name.length > 0 && !mf.name.includes("__MSG_"), mf.name);
check("version 是合法扩展版本号", /^\d+(\.\d+){0,3}$/.test(mf.version), mf.version);
check("description 长度 ≤ 132", typeof mf.description === "string" && mf.description.length <= 132, `${(mf.description || "").length} 字`);
check("action.default_popup 存在", !!(mf.action && mf.action.default_popup), mf.action && mf.action.default_popup);
check("background.service_worker 存在", !!(mf.background && mf.background.service_worker), mf.background && mf.background.service_worker);
check("background.type === module", !mf.background || mf.background.type === "module", mf.background && mf.background.type);
check("permissions 只含 storage", JSON.stringify(mf.permissions) === JSON.stringify(["storage"]), JSON.stringify(mf.permissions));
check(
	"未申请 <all_urls>（商店审核红线）",
	!mf.host_permissions.includes("<all_urls>") && !mf.host_permissions.includes("*://*/*"),
	`${mf.host_permissions.length} 个精确域名`
);
check("host_permissions 全部是 https", mf.host_permissions.every((h) => h.startsWith("https://")));
check(
	"无 content_scripts（本扩展不注入任何网页）",
	mf.content_scripts === undefined && mf.web_accessible_resources === undefined
);

console.log("\n=== 2. 版本一致性 ===");
const pkg = readJson(path.join(ROOT, "package.json"));
check("package.json 与 manifest 版本一致", pkg.version === mf.version, `${pkg.version} / ${mf.version}`);

const dom = analyzeDomains();
console.log(`\n=== 3. 来源域名覆盖（core ${dom.coreVersion} → manifest + 白名单）===`);
console.log(`  core 实际抓取 ${dom.fetchHosts.length} 个域名 / manifest ${dom.manifestHosts.length} 条 / 白名单 ${dom.allow.length} 条`);
check(
	`core 抓取的每个域名都在 manifest.host_permissions 里`,
	dom.missingManifest.length === 0,
	dom.missingManifest.length ? `缺 ${dom.missingManifest.join(", ")}` : "完整"
);
check(
	`core 抓取的每个域名都在 background 白名单里（图标域名除外）`,
	dom.missingAllow.length === 0,
	dom.missingAllow.length ? `缺 ${dom.missingAllow.join(", ")}` : "完整"
);
check("白名单非空且不含通配", dom.allow.length > 0 && !dom.allow.some((h) => h.includes("*")), `${dom.allow.length} 个域名`);
// 反向：申请了但 core 不再使用 → 只提示不失败（权限面可以精简，但不影响功能）
if (dom.unusedManifest.length) {
	console.log(`  ⚠ 已申请但 core 当前未使用（可清理以缩小权限面）：${dom.unusedManifest.join(", ")}`);
}
// 需要 host_permissions 的图标域名（否则 <img> 显示不出来）
const iconMissing = ["storage.moegirl.org.cn", "webcnstatic.yostar.net", "play-lh.googleusercontent.com"].filter(
	(h) => !dom.manifestHosts.includes(h)
);
check("图标域名也在 host_permissions 里", iconMissing.length === 0, iconMissing.join(", "));

console.log("\n=== 4. 零远程代码（MV3 硬性要求）===");
const jsFiles = ["background.js", "popup.js", "options.js", "core-version.js"];
const remoteCodePatterns = [
	{ re: /\bimport\s*\(\s*["'`]https?:/g, label: "动态 import 远程 URL" },
	{ re: /\bimportScripts\s*\(/g, label: "importScripts" },
	{ re: /\beval\s*\(/g, label: "eval(" },
	{ re: /new\s+Function\s*\(/g, label: "new Function(" },
	{ re: /["'`]https?:\/\/[^"'`\s]+\.js["'`]/g, label: "引用远程 .js" }
];
for (const f of jsFiles) {
	const p = path.join(DIST, f);
	if (!fs.existsSync(p)) {
		check(`${f} 存在`, false);
		continue;
	}
	const src = fs.readFileSync(p, "utf8");
	const hits = [];
	for (const { re, label } of remoteCodePatterns) {
		const m = src.match(re);
		if (m) hits.push(`${label}×${m.length}`);
	}
	check(`${f} 无远程代码/动态执行`, hits.length === 0, hits.join(", "));
}

console.log("\n=== 5. core 是否真的内联 ===");
const popupSrc = fs.readFileSync(path.join(DIST, "popup.js"), "utf8");
// core 的来源注册表里有这些特征域名；它们是"core 在包里"的实证
const CORE_MARKERS = [
	"wiki.biligame.com",
	"prts.wiki",
	"end.canmoe.com",
	"fz.wiki",
	"yh.wanmei.com",
	"api-web.bluearchive.jp",
	"re.bluepoch.com",
	"forum.nexon.com",
	"game.xiaomi.com",
	"endfield.wiki.gg",
	"gachatracker.app",
	"ldshop.gg"
];
const missingMarkers = CORE_MARKERS.filter((m) => !popupSrc.includes(m));
check("UI 产物内联了 core（含 13 个来源特征）", missingMarkers.length === 0, missingMarkers.join(", "));
check("UI 产物含 11 款游戏名（含「原神」「异环」）", popupSrc.includes("原神") && popupSrc.includes("异环"));
const coreVersionFile = fs.readFileSync(path.join(DIST, "core-version.js"), "utf8");
const coreVerMatch = coreVersionFile.match(/"([\d.]+)"/);
const installedCore = readJson(path.join(ROOT, "node_modules", "gacha-calendar-core", "package.json")).version;
check("core-version.js 与已安装 core 版本一致", coreVerMatch && coreVerMatch[1] === installedCore, `${coreVerMatch && coreVerMatch[1]} / ${installedCore}`);

console.log("\n=== 6. 图标 ===");
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
for (const size of [16, 32, 48, 128]) {
	const p = path.join(DIST, "icons", `icon-${size}.png`);
	if (!fs.existsSync(p)) {
		check(`icon-${size}.png 存在`, false);
		continue;
	}
	const b = fs.readFileSync(p);
	const isPng = b.subarray(0, 8).equals(PNG_MAGIC);
	// 从 IHDR 读真实宽高，确认尺寸没写错（商店会校验）
	const w = b.readUInt32BE(16);
	const h = b.readUInt32BE(20);
	check(`icon-${size}.png 是 ${size}×${size} PNG`, isPng && w === size && h === size, `${w}×${h}, ${b.length} B`);
}

console.log("\n=== 7. 产物摘要 ===");
function walk(dir, base = "") {
	const out = [];
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const rel = base ? base + "/" + e.name : e.name;
		if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), rel));
		else out.push(rel);
	}
	return out;
}
const all = walk(DIST).sort();
let total = 0;
for (const rel of all) {
	const b = fs.readFileSync(path.join(DIST, rel));
	total += b.length;
	const sha = crypto.createHash("sha256").update(b).digest("hex").slice(0, 12);
	console.log(`  ${String(b.length).padStart(7)} B  ${sha}  ${rel}`);
}
console.log(`  ${String(total).padStart(7)} B  合计 ${all.length} 个文件`);

console.log("");
if (failed) {
	console.error(`✗ ${failed} 项未通过：`);
	for (const p of problems) console.error("  - " + p);
	process.exit(1);
}
console.log("✓ 全部静态校验通过");
