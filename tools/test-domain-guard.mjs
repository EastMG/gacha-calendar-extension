// 验证域名守卫的**通过与拒绝两条路径**：在沙箱副本里塞"冒牌 core"（含/不含未授权域名），
// 确认 check-domains 该失败时失败、该通过时通过。绝不在真仓库上做这类测试。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** 仓库根（本文件位于 tools/ 下）。 */
const REAL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LAB = path.join(REAL, "_domain-guard-lab");

/** 造一个副本：tools + manifest + background + 冒牌 core。 */
function makeLab(tag, coreText) {
	const dir = path.join(LAB, tag);
	fs.rmSync(dir, { recursive: true, force: true });
	fs.mkdirSync(path.join(dir, "tools"), { recursive: true });
	fs.mkdirSync(path.join(dir, "src"), { recursive: true });
	fs.mkdirSync(path.join(dir, "node_modules", "gacha-calendar-core"), { recursive: true });

	fs.copyFileSync(path.join(REAL, "tools", "check-domains.mjs"), path.join(dir, "tools", "check-domains.mjs"));
	fs.copyFileSync(path.join(REAL, "manifest.json"), path.join(dir, "manifest.json"));
	fs.copyFileSync(path.join(REAL, "src", "background.js"), path.join(dir, "src", "background.js"));
	fs.writeFileSync(
		path.join(dir, "node_modules", "gacha-calendar-core", "package.json"),
		JSON.stringify({ name: "gacha-calendar-core", version: "0.0.0-test", main: "./core.mjs" }, null, 2)
	);
	fs.writeFileSync(path.join(dir, "node_modules", "gacha-calendar-core", "core.mjs"), coreText, "utf8");
	return dir;
}

function run(dir) {
	// 子进程输出重定向到文件（本机禁止 pipe 捕获子进程输出）
	const out = path.join(dir, "_out.txt");
	const fd = fs.openSync(out, "w");
	const r = spawnSync(process.execPath, ["tools/check-domains.mjs"], { cwd: dir, stdio: ["ignore", fd, fd] });
	fs.closeSync(fd);
	return { started: !r.error, code: r.status, out: fs.readFileSync(out, "utf8") };
}

let failed = 0;
function expect(name, cond, detail = "") {
	console.log(`  ${cond ? "✓" : "✗"} ${name}${detail ? "  " + detail : ""}`);
	if (!cond) failed++;
}

// —— 用例 1：冒牌 core 含一个未授权域名 → 必须失败并点名 ——
{
	const dir = makeLab("bad", `const U = "https://evil-not-allowed.example.com/api/x";\n`);
	const r = run(dir);
	const last = r.out.trim().split("\n").filter(Boolean).pop();
	expect("未授权域名 → 退出码非 0", r.started && r.code !== 0, `exit ${r.code}`);
	expect("报告里点名了该域名", r.out.includes("evil-not-allowed.example.com"), "");
	expect("给出了修法提示", /host_permissions|ALLOW_HOSTS/.test(r.out), "");
	console.log(`    末行: ${last}`);
}

// —— 用例 2：只用已授权域名 → 必须通过 ——
{
	const dir = makeLab("good", `const U = "https://yh.wanmei.com/news/";\nconst V = "https://notice.sl916.com/noticecp/client/query";\n`);
	const r = run(dir);
	expect("已授权域名 → 退出码 0", r.started && r.code === 0, `exit ${r.code}`);
}

// —— 用例 3：噪声域名（SVG 命名空间、文档链接）不应被当成来源 → 仍通过 ——
{
	const dir = makeLab("noise", `const SVG = "http://www.w3.org/2000/svg";\nconst DOC = "https://github.com/EastMG/gacha-calendar";\n`);
	const r = run(dir);
	expect("w3.org / github.com 等噪声被忽略 → 退出码 0", r.started && r.code === 0, `exit ${r.code}`);
	if (r.out.includes("w3.org") || r.out.includes("github.com")) {
		console.log("    注意：噪声域名出现在了输出里");
	}
}

// —— 用例 4：图标域名不需要进抓取白名单 → 通过 ——
{
	const dir = makeLab("icon", `const I = "https://storage.moegirl.org.cn/moegirl/commons/x.png";\n`);
	const r = run(dir);
	expect("图标域名（在 manifest、不在白名单）→ 退出码 0", r.started && r.code === 0, `exit ${r.code}`);
}

fs.rmSync(LAB, { recursive: true, force: true });
console.log("");
if (failed) {
	console.log(`✗ ${failed} 项未通过`);
	process.exit(1);
}
console.log("✓ 域名守卫的通过与拒绝路径均正确（4/4）");
