// 专用探针：验证 manifest 的 __MSG_ 占位符在**真实浏览器**里是否解析成功。
//
// 为什么单独写：i18n 改动后最危险的不是"加载失败"（那会直接报错），而是
// **静默显示成字面量 `__MSG_extensionName__`**。verify-boot 会把解析结果写进
// chrome.storage 的 LevelDB，但读 LevelDB 那条路本机不稳定；
// 这里改成"加载后直接在 profile 里搜字符串"，命中即可判定。
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROFILE = path.join(ROOT, "_i18n-probe");
const DIST = path.join(ROOT, "dist");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.rmSync(PROFILE, { recursive: true, force: true });
const out = fs.openSync(path.join(ROOT, "_i18n-probe-out.txt"), "w");
const child = spawn(
	EDGE,
	[
		`--user-data-dir=${PROFILE}`,
		`--load-extension=${DIST}`,
		`--disable-extensions-except=${DIST}`,
		"--no-first-run",
		"--no-default-browser-check",
		"about:blank"
	],
	{ stdio: ["ignore", out, out] }
);

console.log("启动浏览器加载扩展，等 30 秒让它落盘…");
await sleep(30000);
try { child.kill(); } catch { /* ignore */ }
await sleep(4000);
fs.closeSync(out);

// 在 profile 里搜字符串
const hits = { resolved: [], placeholder: [] };
const walk = (dir) => {
	let entries = [];
	try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
	for (const e of entries) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) { walk(p); continue; }
		let buf;
		try { buf = fs.readFileSync(p); } catch { continue; }
		const t = buf.toString("utf8");
		if (t.includes("二游日历")) hits.resolved.push(path.relative(PROFILE, p));
		if (t.includes("__MSG_extensionName__")) hits.placeholder.push(path.relative(PROFILE, p));
	}
};
walk(PROFILE);

console.log("\n=== 结果 ===");
console.log(`  含解析后的名称「二游日历」的文件: ${hits.resolved.length}`);
for (const f of hits.resolved.slice(0, 6)) console.log(`      ${f}`);
console.log(`  含未解析占位符 __MSG_extensionName__ 的文件: ${hits.placeholder.length}`);
for (const f of hits.placeholder.slice(0, 6)) console.log(`      ${f}`);

const ok = hits.resolved.length > 0 && hits.placeholder.length === 0;
console.log(`\n${ok ? "✓" : "✗"} i18n 占位符在真实浏览器里${ok ? "解析成功" : "未能确认解析成功"}`);
fs.rmSync(PROFILE, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
