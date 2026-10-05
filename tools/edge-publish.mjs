// 自动发布新版本到 Microsoft Edge 加载项商店（官方 Update REST API v1.1）。
//
// ⚠️ 能力边界（先读，避免误以为它什么都能做）：
//   官方 API **只能更新已存在的产品**。它没有"创建新产品"和"修改商店元数据（说明/截图等）"的端点
//   —— 这两件事必须在 Partner Center 网页完成，且**只做一次**（首次上架）。
//   首次上架之后，每次发版都可以用本脚本一条命令搞定。
//
//   官方原文："There aren't REST API endpoints for: Creating a new product.
//   Updating a product's metadata, such as the description."
//   https://learn.microsoft.com/zh-cn/microsoft-edge/extensions-chromium/publish/api/using-addons-api
//
// 需要的三样东西（都在 Partner Center 的「Publish API」页生成）：
//   EDGE_CLIENT_ID     客户端 ID
//   EDGE_API_KEY       API 密钥（有效期约 72 天，过期需重新生成）
//   EDGE_PRODUCT_ID    产品 ID（扩展「概述」页上的 GUID）
//
// 用法：
//   node tools/edge-publish.mjs --dry-run          # 只校验环境与包，不发请求
//   node tools/edge-publish.mjs                    # 上传 + 发布（用 release/ 里当前版本的 zip）
//   node tools/edge-publish.mjs --zip path/to.zip  # 指定包
//   node tools/edge-publish.mjs --notes "本次改动"  # 认证说明
//   node tools/edge-publish.mjs --upload-only      # 只上传不发布（留在草稿里人工确认）
//
// 退出码：0 成功；1 用法/环境/包问题；2 上传失败；3 发布失败。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://api.addons.microsoftedge.microsoft.com";
const API_VERSION = "v1";

// ---------- 参数 ----------
const argv = process.argv.slice(2);
const arg = (name) => {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name) => argv.includes(name);

const DRY = has("--dry-run");
const UPLOAD_ONLY = has("--upload-only");
const NOTES = arg("--notes") || "";
const POLL_TIMEOUT_MS = Number(arg("--timeout") || 15 * 60 * 1000);
const POLL_INTERVAL_MS = Number(arg("--interval") || 5000);

// ---------- 输出 ----------
const say = (s = "") => console.log(s);
const fail = (code, msg) => {
	console.error(`\n✗ ${msg}`);
	process.exit(code);
};

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

// ---------- 1. 校验环境 ----------
say("=== 1. 环境与凭据 ===");
const CLIENT_ID = process.env.EDGE_CLIENT_ID;
const API_KEY = process.env.EDGE_API_KEY;
const PRODUCT_ID = process.env.EDGE_PRODUCT_ID;

const missing = [
	["EDGE_CLIENT_ID", CLIENT_ID],
	["EDGE_API_KEY", API_KEY],
	["EDGE_PRODUCT_ID", PRODUCT_ID]
].filter(([, v]) => !v || String(v).trim() === "");

if (missing.length) {
	say(`  ✗ 缺少环境变量：${missing.map(([k]) => k).join(", ")}`);
	if (!DRY) {
		fail(1, "缺凭据，无法发布。先去 Partner Center 的「Publish API」页生成，然后设置环境变量。");
	}
} else {
	// 只回显可辨识的片段，避免把密钥整串打到日志/CI 输出里
	const mask = (s) => (s.length <= 8 ? "****" : `${s.slice(0, 4)}…${s.slice(-4)}`);
	say(`  ✓ EDGE_CLIENT_ID   ${mask(CLIENT_ID)}`);
	say(`  ✓ EDGE_API_KEY     ${mask(API_KEY)}`);
	say(`  ✓ EDGE_PRODUCT_ID  ${PRODUCT_ID}`);
}
say(`  扩展版本 package.json: ${pkg.version}`);

// PRODUCT_ID 官方是 GUID；只做宽松校验，避免把真实错误挡在本地
if (PRODUCT_ID && !/^[0-9a-fA-F-]{32,40}$/.test(PRODUCT_ID.trim())) {
	say(`  ⚠ EDGE_PRODUCT_ID 不是预期的 GUID 形式，仍会按原样使用`);
}

// ---------- 2. 定位 zip ----------
say("\n=== 2. 发布包 ===");
const zipPath = arg("--zip") || path.join(ROOT, "release", `gacha-calendar-extension-${pkg.version}.zip`);
if (!fs.existsSync(zipPath)) {
	fail(1, `找不到发布包：${path.relative(ROOT, zipPath)}\n  先跑：node build.mjs --zip`);
}
const zipBuf = fs.readFileSync(zipPath);
// 本地先自证：zip 合法且根目录有 manifest.json（否则要上传后才会被拒）
say(`  包：${path.relative(ROOT, zipPath)}  ${(zipBuf.length / 1024).toFixed(1)} KB`);
const { verifyZip } = await import("./verify-zip.mjs");
const zipRes = verifyZip(zipPath);
if (!zipRes.ok) {
	say(`  ✗ 包自校验未通过：`);
	for (const pr of zipRes.problems) say(`      ${pr}`);
	fail(1, "发布包有问题，先修好再上传。");
}
say(`  ✓ 包自校验通过（${zipRes.entries.length}/${zipRes.total} 条目，CRC 正常，根目录含 manifest.json）`);

// ---------- 请求工具 ----------
const headers = () => ({
	Authorization: `ApiKey ${API_KEY}`,
	"X-ClientID": CLIENT_ID
});

/** 统一请求：返回 { status, location, json, text }。 */
async function call(method, url, { body, contentType } = {}) {
	const h = headers();
	if (contentType) h["Content-Type"] = contentType;
	const res = await fetch(url, { method, headers: h, body });
	const text = await res.text();
	let json = null;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		/* 非 JSON 就保留原文 */
	}
	return { status: res.status, location: res.headers.get("location"), json, text };
}

/** 把 HTTP 状态码翻译成可操作的提示。 */
function hintFor(status) {
	switch (status) {
		case 401:
		case 403:
			// 实测：非法 API 密钥返回的是 **403**（不是 401），且响应体为空。
			return [
				"凭据被拒。逐项核对：",
				"  · API 密钥是否有效 —— 约 72 天过期，去 Partner Center「Publish API」页重新生成；",
				"  · X-ClientID 是否与生成密钥时的客户端 ID 一致；",
				"  · 该账号是否确实拥有这个产品（产品 ID 属于别的账号也会走到这里）。",
				"  注：官方文档只提到 401，但实测无效密钥返回 403 且无响应体。"
			].join("\n  ");
		case 404:
			return "产品 ID 不存在或不属于当前账号。去 Partner Center 的扩展「概述」页复制 Product ID。";
		case 400:
			return "包被拒。常见原因：manifest 校验失败、版本号没有递增（必须大于商店里的现有版本）、zip 结构不对。";
		case 429:
			return "请求过于频繁，稍后重试。";
		default:
			return status >= 500 ? "服务端错误（可能是微软侧临时故障），稍后重试。" : "见下方响应体。";
	}
}

/** 打印失败详情：响应体为空时不要打印空行。 */
function reportFailure(label, r) {
	const body = (r.text || "").trim();
	console.error(`✗ ${label}：HTTP ${r.status}`);
	console.error(`  ${hintFor(r.status)}`);
	if (body) console.error(`  响应：${body.slice(0, 500)}`);
	else console.error("  响应体为空（该接口在鉴权失败时可能不返回内容）");
}
function operationIdOf(location) {
	if (!location) return null;
	const s = String(location).trim().replace(/\/+$/, "");
	return s.includes("/") ? s.split("/").pop() : s;
}

/**
 * 轮询操作状态直到非 InProgress。
 * 官方语义：状态接口在"仍在进行"时返回 202，完成/失败后返回 200。
 */
async function poll(urlBase, operationId, label) {
	const t0 = Date.now();
	let last = "";
	for (;;) {
		if (Date.now() - t0 > POLL_TIMEOUT_MS) {
			return { ok: false, detail: `轮询超时（${(POLL_TIMEOUT_MS / 1000).toFixed(0)}s），最后状态：${last || "未知"}` };
		}
		const r = await call("GET", `${urlBase}/operations/${operationId}`);
		last = (r.json && (r.json.status || r.json.Status)) || r.text.slice(0, 200) || `HTTP ${r.status}`;
		process.stdout.write(`\r  ${label}：${last}                    `);
		// 202 = 仍在进行；200 表示操作已结束
		if (r.status !== 202) {
			process.stdout.write("\n");
			const s = String(last).toLowerCase();
			const ok = s.includes("succeed") || s.includes("success");
			return { ok, detail: last, json: r.json };
		}
		await new Promise((r2) => setTimeout(r2, POLL_INTERVAL_MS));
	}
}

if (DRY) {
	say("\n=== --dry-run：到此为止，未发出任何请求 ===");
	say(`  将要执行：`);
	say(`    1) POST ${API}/${API_VERSION}/products/<PRODUCT_ID>/submissions/draft/package   （上传 ${(zipBuf.length / 1024).toFixed(1)} KB）`);
	say(`    2) 轮询上传状态`);
	if (!UPLOAD_ONLY) say(`    3) POST ${API}/${API_VERSION}/products/<PRODUCT_ID>/submissions            （发布，notes=${NOTES ? "有" : "空"}）`);
	else say(`    3) 跳过发布（--upload-only：留在草稿里）`);
	process.exit(0);
}

// ---------- 3. 上传 ----------
say("\n=== 3. 上传包 ===");
const uploadUrl = `${API}/${API_VERSION}/products/${PRODUCT_ID}/submissions/draft/package`;
let up;
try {
	up = await call("POST", uploadUrl, { body: zipBuf, contentType: "application/zip" });
} catch (e) {
	fail(2, `上传请求失败（网络层）：${String((e && e.message) || e)}`);
}

if (up.status !== 202) {
	reportFailure("上传失败", up);
	fail(2, "本轮到此为止，未做任何变更。");
}
const upOp = operationIdOf(up.location);
say(`  已接受（202），operationId=${upOp || "（未在 Location 头里返回）"}`);
if (!upOp) fail(2, "上传已受理但拿不到 operationId，无法继续。Location 头为空。");

const upRes = await poll(`${uploadUrl}`, upOp, "上传进度");
if (!upRes.ok) fail(2, `上传未成功：${upRes.detail}`);
say(`  ✓ 上传完成：${upRes.detail}`);

if (UPLOAD_ONLY) {
	say("\n=== 已完成上传（--upload-only）===");
	say("  包已在草稿里，去 Partner Center 检查后手动点「发布」。");
	process.exit(0);
}

// ---------- 4. 发布 ----------
say("\n=== 4. 发布 ===");
const pubUrl = `${API}/${API_VERSION}/products/${PRODUCT_ID}/submissions`;
let pub;
try {
	pub = await call("POST", pubUrl, {
		body: JSON.stringify({ notes: NOTES || `自动发布 v${pkg.version}` }),
		contentType: "application/json"
	});
} catch (e) {
	fail(3, `发布请求失败（网络层）：${String((e && e.message) || e)}`);
}
if (pub.status !== 202) {
	reportFailure("发布失败", pub);
	fail(3, "发布未提交。");
}
const pubOp = operationIdOf(pub.location);
say(`  已受理（202），operationId=${pubOp || "（未在 Location 头里返回）"}`);
if (!pubOp) fail(3, "发布已受理但拿不到 operationId。Location 头为空。");

const pubRes = await poll(`${pubUrl}`, pubOp, "发布进度");
if (!pubRes.ok) fail(3, `发布未成功：${pubRes.detail}`);

say(`\n✓ v${pkg.version} 已提交到 Edge 加载项商店，等待认证（官方说明最多 7 个工作日）`);
say("  状态可在 Partner Center 查看；认证通过后商店会自动更新。");
