// Chromium 运行时验证（**在普通桌面环境运行**；带文件沙箱的受限环境跑不起来）。
//
// 这一步补的是"扩展在真实浏览器里被加载并真的抓了一轮"。做法：
//   1. `node build.mjs --verify` 把 src/verify-boot.js 打进 background.js
//      —— service worker 一定会随扩展加载而执行，是浏览器里最可靠的落点
//   2. 启动 Chromium 系浏览器并加载 dist/
//   3. service worker 自己跑完 11 款实抓 + 两条取数通道检查，把报告写进 chrome.storage.local
//   4. 关掉浏览器，从 profile 的 LevelDB 里把报告读回来断言
//
// 为什么不用 CDP：部分环境下 Node 内置 WebSocket 与 Chrome DevTools 协议层不通
// （能握手、命令零响应）。而 service worker + chrome.storage 这条路不需要 CDP，也不需要网络。
//
// 用法：node tools/verify-chromium.mjs
//   环境变量 CHROME_PATH / EDGE_PATH 可指定浏览器；默认按常见路径探测。
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const PROFILE = path.join(ROOT, "_chromium-profile");
const PORT = 9371;

const BROWSER = [
	process.env.CHROME_PATH,
	process.env.EDGE_PATH,
	"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
	"C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
	"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
	process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Google\\Chrome\\Application\\chrome.exe") : null,
	"/usr/bin/google-chrome",
	"/usr/bin/chromium",
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
].find((p) => p && fs.existsSync(p));

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

/** 从 LevelDB blob 里截出自检报告对象（不关心是哪个扩展 ID 的存储）。 */
function extractReport(blobs) {
	for (const buf of blobs) {
		for (const enc of ["utf8", "utf16le", "latin1"]) {
			const text = buf.toString(enc);
			// 值可能是 JSON 原文，也可能是被转义的形态
			for (const marker of ['"where":"service_worker"', '\\"where\\":\\"service_worker\\"', "where.*service_worker"]) {
				const idx = text.search(marker.startsWith("where.") ? /where[^\w]{1,8}service_worker/ : new RegExp(escapeRe(marker)));
				if (idx < 0) continue;
				const start = text.lastIndexOf("{", idx);
				if (start < 0) continue;
				// 括号配对截出完整 JSON（跳过字符串内的括号）
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
						return { report: JSON.parse(candidate), encoding: enc };
					} catch {}
				}
			}
		}
	}
	return null;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 扫 profile 里所有扩展存储的 LevelDB，找出自检报告。 */
function readReport(profileDir) {
	const base = path.join(profileDir, "Default", "Local Extension Settings");
	if (!fs.existsSync(base)) return { error: "没有 Local Extension Settings 目录（没有扩展写出过 storage）" };
	const blobs = [];
	const perExt = [];
	for (const id of fs.readdirSync(base)) {
		const dir = path.join(base, id);
		if (!fs.statSync(dir).isDirectory()) continue;
		const files = fs.readdirSync(dir).filter((f) => /\.(log|ldb)$/.test(f));
		perExt.push(`${id}(${files.length})`);
		for (const f of files) blobs.push(fs.readFileSync(path.join(dir, f)));
	}
	if (blobs.length === 0) return { error: `存储目录为空：${perExt.join(", ") || "无子目录"}` };
	const got = extractReport(blobs);
	if (!got) return { error: `在 ${blobs.length} 个 LevelDB 文件里没找到报告`, perExt };
	return { ...got, blobs: blobs.length, perExt };
}

async function main() {
	say("=== 0. 准备 ===");
	if (!BROWSER) {
		say("✗ 没找到 Chromium 系浏览器。用 CHROME_PATH/EDGE_PATH 指定后重试。");
		process.exit(1);
	}
	say(`  浏览器: ${BROWSER}`);
	execFileSync(process.execPath, ["build.mjs", "--verify"], { cwd: ROOT, stdio: "inherit" });
	const bgSize = fs.statSync(path.join(DIST, "background.js")).size;
	check("自检已打进 background.js", bgSize > 100000, `${bgSize} B（正常构建约 5 KB）`);

	say("\n=== 1. 启动浏览器并加载扩展 ===");
	fs.rmSync(PROFILE, { recursive: true, force: true });
	const outFd = fs.openSync(path.join(ROOT, "_chromium-out.txt"), "w");
	// 扩展 ID 由目录派生但并非简单 sha256(path)，所以不自己算：
	// 让浏览器列出候选，再由本脚本按"哪个候选有 popup.html"来确认，全程用 HTTP 版 DevTools 接口。
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

	// 逐个候选打开 popup.html，能打开（标题变为"二游排期"）的就是本项目扩展
	let ownId = null;
	for (let i = 0; i < 60 && !ownId; i++) {
		await sleep(500);
		let list;
		try {
			list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
		} catch {
			continue;
		}
		for (const t of list) {
			if (t.type !== "service_worker" || !t.url.startsWith("chrome-extension://")) continue;
			const id = new URL(t.url).host;
			// 组件扩展的 sw 路径通常不是 background.js
			if (!/\/background\.js$/.test(t.url)) continue;
			try {
				await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(`chrome-extension://${id}/popup.html`)}`, {
					method: "PUT"
				});
			} catch {}
			await sleep(1200);
			const list2 = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
			const page = list2.find((p) => p.type === "page" && p.url.includes(id) && p.url.includes("popup.html"));
			if (page) {
				ownId = id;
				say(`  扩展 ID: ${ownId}  title="${page.title}"`);
				check("扩展加载并在浏览器中打开 popup 页面", /二游排期/.test(page.title || ""), `title="${page.title}"`);
			}
		}
	}
	if (!ownId) check("扩展加载并在浏览器中打开 popup 页面", false, "没找到本项目的扩展页");

	// 轮询：**必须等到报告本身可读**再关浏览器。
	// 曾经的坑：一看到 storage 目录出现就 break 并 kill，结果 service worker 的写入
	// 还没被 LevelDB 刷到磁盘文件里，报告读不出来。
	const deadline = Date.now() + 180000;
	let got = null;
	let grew = false;
	let ticks = 0;
	while (Date.now() < deadline) {
		await sleep(4000);
		ticks++;
		const base = path.join(PROFILE, "Default", "Local Extension Settings");
		if (!fs.existsSync(base)) continue;
		const ids = fs.readdirSync(base);
		const mine = ownId ? ids.includes(ownId) : ids.length > 0;
		const n = ids.reduce((acc, id) => {
			try {
				return acc + fs.readdirSync(path.join(base, id)).length;
			} catch {
				return acc;
			}
		}, 0);
		if (mine && n > 0) grew = true;
		const probe = readReport(PROFILE);
		// 每 5 次（约 20s）打一行，避免刷屏
		if (ticks % 5 === 1 || probe.report) {
			say(`    ${ticks * 4}s: 存储 ${n} 个文件${mine ? "（含本项目扩展）" : ""}${probe.report ? "，已读到报告 ✓" : ""}`);
		}
		if (probe.report) {
			got = probe;
			break;
		}
	}

	// 关浏览器前再等一会，给 LevelDB 落盘（运行中已读到则不必）
	if (!got) {
		say("  运行中未读到报告，关闭前多留 12s 等落盘…");
		await sleep(12000);
	}
	try { child.kill(); } catch {}
	await sleep(4000);
	fs.closeSync(outFd);
	check("service worker 执行并写出 storage", grew);

	say("\n=== 2. 读取自检报告 ===");
	if (!got) got = readReport(PROFILE);
	if (!got.report) {
		check("读到报告", false, got.error);
		if (got.perExt) say(`  各扩展存储: ${got.perExt.join(", ")}`);
		say("  排查方向：看 _chromium-out.txt；受限环境会挡住浏览器子进程访问 profile。");
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
		// bwiki 会风控（HTTP 567），阈值放宽；非 bwiki 源应全部成功
		check("卡池有内容 ≥ 5 款", r.gacha >= 5, `${r.gacha}/11`);
		check("活动有内容 ≥ 5 款", r.event >= 5, `${r.event}/11`);

		const rows = (s.rows && s.rows.rows) || [];
		check("面板渲染模型算出 11 行", rows.length === 11, `${rows.length} 行`);
		check("起止列出现倒计时", rows.some((x) => /还剩|还有|已结束/.test(x.gachaDates || "")), "");
		check("顶部提示已生成", /成功\s+\d+\/11/.test((s.scrapeInfo && s.scrapeInfo.info) || ""), (s.scrapeInfo && s.scrapeInfo.info) || "");
		if (rows.length) {
			say("  逐行：");
			for (const x of rows) {
				say(`    ${x.name.padEnd(16)} 卡池=${(x.gacha || "").slice(0, 20).padEnd(20)} 活动=${(x.event || "").slice(0, 16).padEnd(16)} ${x.gachaDates || ""} ${x.badge || ""}`);
			}
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
