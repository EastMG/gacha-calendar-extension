// 校验商店文案与素材是否符合 Edge 加载项商店的硬性限制。
//
// 为什么需要：这些限制（名称 45、简短说明 132、详细说明 250~10000、搜索词 7 个/合计 21 字、
// 截图只能 640×480 或 1280×800 …）都是**提交时才会报错**的，等到在 Partner Center 表单里
// 逐项被拒才发现，来回成本很高。这里在本地一次查完。
//
// 官方依据：https://learn.microsoft.com/zh-cn/microsoft-edge/extensions-chromium/publish/publish-extension
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LISTING = path.join(ROOT, "store", "listing-zh-CN.md");

let failed = 0;
const check = (name, ok, detail = "") => {
	console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? "  " + detail : ""}`);
	if (!ok) failed++;
};

/** 字数按"字符数"算（中文一字一符），与商店表单的计数口径一致。 */
const len = (s) => [...s].length;

/** 取 markdown 中某个二级标题下第一个围栏代码块的内容。 */
function fencedBlockUnder(md, headingKeyword) {
	const lines = md.split("\n");
	let i = lines.findIndex((l) => l.startsWith("## ") && l.includes(headingKeyword));
	if (i < 0) return null;
	for (; i < lines.length; i++) {
		if (!lines[i].startsWith("```")) continue;
		const out = [];
		for (let j = i + 1; j < lines.length && !lines[j].startsWith("```"); j++) out.push(lines[j]);
		return out.join("\n");
	}
	return null;
}

/** 读 PNG 头拿宽高。 */
function pngSize(file) {
	const b = fs.readFileSync(file);
	if (b.toString("hex", 0, 8) !== "89504e470d0a1a0a") return null;
	return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

console.log("=== 1. manifest 字段（上传 zip 后自动带出，表单里改不了）===");
const mf = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
check("扩展名称 ≤ 45 字符", len(mf.name) <= 45, `「${mf.name}」${len(mf.name)} 字符`);
check("简短说明（description）≤ 132 字符", len(mf.description) <= 132, `${len(mf.description)} 字符`);
check("Manifest V3", mf.manifest_version === 3, `v${mf.manifest_version}`);
check("未申请 <all_urls>", !mf.host_permissions.includes("<all_urls>") && !mf.host_permissions.includes("*://*/*"));
check("无内容脚本（content script）", !("content_scripts" in mf), "不读取/修改网页");

if (!fs.existsSync(LISTING)) {
	console.error(`✗ 缺少 ${path.relative(ROOT, LISTING)}`);
	process.exit(1);
}
const md = fs.readFileSync(LISTING, "utf8");

console.log("\n=== 2. 详细说明（每种语言必填，250 ~ 10000 字符）===");
const desc = fencedBlockUnder(md, "说明");
if (!desc) {
	check("能解析出详细说明", false, "未在 listing 里找到「## 二、说明」下的代码块");
} else {
	const n = len(desc);
	check("详细说明 ≥ 250 字符", n >= 250, `${n} 字符`);
	check("详细说明 ≤ 10000 字符", n <= 10000, `${n} 字符`);
	// 文档里声明了字数就必须与实际一致 —— 否则读者按旧数字判断，而数字已经漂了
	const declared = md.match(/当前字数：(\d+)\s*字符/);
	check("文档声明的字数与实际一致", declared && Number(declared[1]) === n, `实际 ${n}，文档声明 ${declared ? declared[1] : "（未声明）"}`);
}

console.log("\n=== 3. 搜索词（最多 7 个，合计 ≤21 字，每词 ≤30 字符）===");
const termsBlock = fencedBlockUnder(md, "搜索词");
if (!termsBlock) {
	check("能解析出搜索词", false);
} else {
	const terms = termsBlock.split("\n").map((s) => s.trim()).filter(Boolean);
	const total = terms.reduce((a, t) => a + len(t), 0);
	check("搜索词数量 ≤ 7", terms.length <= 7, `${terms.length} 个`);
	check("每个搜索词 ≤ 30 字符", terms.every((t) => len(t) <= 30), terms.map((t) => len(t)).join("/"));
	check("合计字数 ≤ 21", total <= 21, `合计 ${total} 字：${terms.join("、")}`);
}

console.log("\n=== 4. 图片素材（尺寸必须精确匹配，否则表单会拒）===");
const assets = [
	["store/assets/logo-300.png", [[300, 300], [128, 128]], "扩展徽标：300×300 建议，最小 128×128"],
	["store/assets/promo-small-440x280.png", [[440, 280]], "小型促销磁贴"],
	["store/assets/promo-large-1400x560.png", [[1400, 560]], "大型促销磁贴"],
	["store/screenshots/01-panel.png", [[640, 480], [1280, 800]], "屏幕截图"],
	["store/screenshots/02-settings.png", [[640, 480], [1280, 800]], "屏幕截图"],
	["store/screenshots/03-remove-restore.png", [[640, 480], [1280, 800]], "屏幕截图"]
];
for (const [rel, allowed, what] of assets) {
	const f = path.join(ROOT, rel);
	if (!fs.existsSync(f)) {
		check(`${what} ${rel}`, false, "文件缺失");
		continue;
	}
	const s = pngSize(f);
	if (!s) {
		check(`${what} ${rel}`, false, "不是 PNG");
		continue;
	}
	const ok = allowed.some(([w, h]) => w === s.w && h === s.h);
	check(`${what} ${path.basename(rel)}`, ok, `${s.w}×${s.h}（允许 ${allowed.map((a) => a.join("×")).join(" 或 ")}）`);
}

console.log("\n=== 5. 隐私政策可托管性 ===");
const privacy = path.join(ROOT, "docs", "privacy.html");
check("docs/privacy.html 存在", fs.existsSync(privacy));
if (fs.existsSync(privacy)) {
	const html = fs.readFileSync(privacy, "utf8");
	check("政策提到不收集数据", /不收集/.test(html));
	check("政策说明了本地存储", /chrome\.storage\.local/.test(html));
	check("政策含联系方式", /issues/.test(html));
}
check("listing 里给出了隐私政策 URL", /https:\/\/\S*privacy\.html/.test(md));

console.log("");
if (failed) {
	console.log(`✗ ${failed} 项未通过`);
	process.exit(1);
}
console.log("✓ 商店文案与素材全部符合 Edge 加载项商店的限制");
