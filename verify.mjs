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
import { fileURLToPath, pathToFileURL } from "node:url";
import { analyzeDomains, manifestCovers } from "./tools/check-domains.mjs";
import { resolveManifestText } from "./tools/i18n.mjs";

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

// name / description 在源 manifest 里是 `__MSG_xxx__` 占位符 —— 这本身合法，
// 浏览器会用包内 `_locales` 解析。真正要拦的是"**解析不出来**"：
// 缺 _locales、缺 default_locale、或键名写错，都会让扩展名变成字面量 `__MSG_...__`。
const mfText = resolveManifestText(mf, DIST);
check("manifest_version === 3", mf.manifest_version === 3, String(mf.manifest_version));
check(
	"name / description 的 i18n 占位符可解析",
	mfText.problems.length === 0,
	mfText.problems.length ? mfText.problems.join("；") : `locale=${mfText.locale}，可用 ${mfText.locales.join("/") || "—"}`
);
check("name 非空", mfText.name.length > 0, mfText.name);
check("version 是合法扩展版本号", /^\d+(\.\d+){0,3}$/.test(mf.version), mf.version);
check("description 长度 ≤ 132（解析后）", mfText.description.length <= 132, `${mfText.description.length} 字`);
check("包里带 _locales 目录（商店据此识别可用语言）", mfText.locales.length > 0, mfText.locales.join(", "));
check("action.default_popup 存在", !!(mf.action && mf.action.default_popup), mf.action && mf.action.default_popup);
check("background.service_worker 存在", !!(mf.background && mf.background.service_worker), mf.background && mf.background.service_worker);
check("background.type === module", !mf.background || mf.background.type === "module", mf.background && mf.background.type);
// 权限面：只允许 storage 与 declarativeNetRequestWithHostAccess。
// 后者是给 GameKee CDN 注入 Referer 用的（Chrome 的 fetch 不能设 Referer）——
// 它只对已授权的 host 生效，不含"拦截全站请求"的 declarativeNetRequest 权限。
const ALLOWED_PERMS = ["storage", "declarativeNetRequestWithHostAccess"];
const extraPerms = (mf.permissions || []).filter((p) => !ALLOWED_PERMS.includes(p));
check(
	"permissions 只有 storage（+ 注入 Referer 用的 declarativeNetRequestWithHostAccess）",
	extraPerms.length === 0,
	JSON.stringify(mf.permissions)
);
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

// —— declarativeNetRequest：GameKee CDN 需要 Referer，而 fetch 不能设置 Referer ——
{
  const dnrPath = path.join(ROOT, "dist", "dnr.json");
  const mf2 = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  const rules = mf2.declarative_net_request?.rule_resources || [];
  check("manifest 声明了 DNR 规则集", rules.length > 0, rules.map((r) => r.path).join(", "));
  check(
    "已申请 declarativeNetRequestWithHostAccess（改请求头所需，不申请 would-be 全站拦截权限）",
    (mf2.permissions || []).includes("declarativeNetRequestWithHostAccess")
  );
  check("规则文件已进入产物", fs.existsSync(dnrPath), dnrPath);
  // ⚠️ 这条是踩坑补的：build.mjs 用**字段白名单**写 manifest，declarative_net_request 曾因此被丢弃，
  //    症状是"规则文件在、但规则集没加载"（SW 里 chrome.declarativeNetRequest 也拿不到规则）。
  const distMf = JSON.parse(fs.readFileSync(path.join(ROOT, "dist", "manifest.json"), "utf8"));
  check(
    "产物 manifest 带上 declarative_net_request（build 白名单没丢字段）",
    !!distMf.declarative_net_request && (distMf.declarative_net_request.rule_resources || []).length > 0,
    JSON.stringify(distMf.declarative_net_request || null)
  );
  let ok = false;
  try {
    const rs = JSON.parse(fs.readFileSync(dnrPath, "utf8"));
    const rule = rs.find((r) => String(r.condition?.urlFilter || "").includes("api-cdn.gamekee.com"));
    ok = !!rule && (rule.action?.requestHeaders || []).some(
      (h) => h.header === "Referer" && h.operation === "set" && h.value === "https://www.gamekee.com/"
    );
  } catch { /* 解析失败即视为不通过 */ }
  check("规则 = 给 api-cdn.gamekee.com 注入 Referer: https://www.gamekee.com/", ok);
}

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
// 需要 host_permissions 的图标域名（否则 <img> 显示不出来）。
// ⚠️ 必须从 core **动态推导**，不能写死域名列表 —— 写死的名单会随 core 换图标源而过期
// （2026-10-21 就踩到：core 把 28 个外链图标统一换到白名单高清源后，
//   webcnstatic.yostar.net / play-lh.googleusercontent.com 在 core 里已 0 次出现，
//   但这里仍写死着它们，导致校验器对着一个已不存在的问题报错）。
const iconMissing = dom.iconHosts.filter((h) => !manifestCovers(new Set(dom.manifestHosts), h));
check("图标域名也在 host_permissions 里", iconMissing.length === 0, iconMissing.length ? iconMissing.join(", ") : `${dom.iconHosts.length} 个图标域名均已授权`);

console.log("\n=== 4. 零远程代码（MV3 硬性要求）===");
const jsFiles = ["background.js", "popup.js", "options.js", "panel.js", "core-version.js"];
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
check(`UI 产物内联了 core（含 ${CORE_MARKERS.length} 个来源特征域名）`, missingMarkers.length === 0, missingMarkers.join(", "));

// 产物体积下界：core 0.11.x 内联后 popup.js 约 400 KB；若明显偏小说明 core 没被完整打进去。
// （不设上界，避免每次扩游戏都要调；也不去搜游戏名——见下方说明）
const popupKb = Math.round(popupSrc.length / 1024);
check("popup.js 体积达到内联 core 的量级（>250 KB）", popupSrc.length > 250 * 1024, `${popupKb} KB`);

// 新日程面板（实验特性）：页面宿主、样式与打包产物必须都在 dist 里，
// 否则开启开关后点工具栏会打不开页面（且不会有任何提示）。
for (const f of ["panel.html", "popup-panel.html", "panel.js", "schedule.css"]) {
	check(`新面板产物存在：${f}`, fs.existsSync(path.join(DIST, f)));
}
const panelSrc = fs.existsSync(path.join(DIST, "panel.js")) ? fs.readFileSync(path.join(DIST, "panel.js"), "utf8") : "";
check("panel.js 内联了 React（生产版，含 react-dom 特征）", /react-dom|Minified React error/.test(panelSrc), `${Math.round(panelSrc.length / 1024)} KB`);
check("panel.js 内含日程视图根类名", panelSrc.includes("gacha-cal-sched"));

// core 的条目数据：**从 core 运行时取**，不写死数字（core 已从 11 款扩到 28 款）。
// 注意：这里**不去产物里搜游戏名**。实测产物中中文被 esbuild 以大写 \uXXXX 转义，
// 且部分名称只以正则片段形式存在（如 /蔚蓝档案)?\s*(?:日服|国际服|国服)?/），
// 直接搜名字既脆弱又测不到关键点。"条目是否齐全"由 verify-live.mjs 真跑一轮来负责。
const corePkgMain = readJson(path.join(ROOT, "node_modules", "gacha-calendar-core", "package.json")).main || "./core.mjs";
const coreEntry = await import(pathToFileURL(path.join(ROOT, "node_modules", "gacha-calendar-core", corePkgMain)).href);
const probeEngine = coreEntry.createEngine({ transport: {}, storage: { async get() {}, async set() {} } });
const coreSources = probeEngine.__test.SOURCES;
const coreEntryCount = coreSources.length;
check("core 运行时暴露全部内置条目（>11）", coreEntryCount > 11, `${coreEntryCount} 个`);
check(
	"条目表含 tz / defaultHidden 字段（0.11.x 新增能力）",
	coreSources.every((s) => typeof s.tz === "string" && typeof s.defaultHidden === "boolean")
);
const defHiddenCount = coreSources.filter((s) => s.defaultHidden).length;
console.log(`  说明：core ${dom.coreVersion} 共 ${coreEntryCount} 个条目，其中 ${defHiddenCount} 个出厂默认隐藏`);
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
