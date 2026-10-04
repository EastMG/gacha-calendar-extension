// 端到端验证（Node 侧）。
//
// ⚠️ 为什么不在浏览器里自动验证：本机 Chrome 是在受限沙箱下启动的，**profile 目录写不进去**
// （实测 profile/Default 为空，连 `Local Extension Settings` 都没建出来）。这导致
// chrome.storage 落盘、扩展页执行、localhost 回传三条通路全部不可用 —— 是环境限制，
// 与扩展代码无关。所以"浏览器里点开 popup"这一步留给人工确认（见 README）。
//
// 本脚本把**能自动化的部分做到最实**：
//   1. 真网络：用与扩展**同一份 transport 契约**跑 core，真抓全部出厂条目
//   2. 真渲染模型：用与 popup **同一份纯函数** buildRowModel 算每一行显示什么，并断言内容
//   3. 覆盖校验：把源码里出现的所有来源域名，与 manifest.host_permissions / background 白名单
//      逐一对齐 —— 这是最容易犯、也最致命的错（漏一个域名 → 那个源在浏览器里静默失败）
//
// 跑法：node verify-live.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, "src");
const DIST = path.join(ROOT, "dist");

const log = [];
function say(...a) {
	const line = a.join(" ");
	log.push(line);
	console.log(line);
}
let failed = 0;
function check(name, ok, detail = "") {
	say(`  ${ok ? "✓" : "✗"} ${name}${detail ? "  " + detail : ""}`);
	if (!ok) failed++;
}

const UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/**
 * Node 侧 transport：与 src/transport.js 的契约完全一致。
 *   fetchRaw     → 原样返回 Response
 *   fetchViaProxy → 返回目标站原始 body 字符串（非 2xx 抛 "http-<code>"）
 * 区别只在于"代发"这一步：扩展里经 background 消息，这里直接在本进程发（Node 无 CORS 限制）。
 */
function makeTransport() {
	const log = [];
	return {
		log,
		transport: {
			async fetchRaw(url, opts) {
				log.push({ kind: "raw", url });
				return fetch(url, opts);
			},
			async fetchViaProxy(url, { referer, headers, body } = {}) {
				log.push({ kind: "proxy", url });
				const target = new URL(url);
				const h = {
					"User-Agent": UA,
					Accept: "application/json, text/plain, */*",
					Referer: referer || target.origin + "/",
					Origin: target.origin,
					...(headers || {})
				};
				const init = { headers: h, redirect: "follow" };
				if (typeof body === "string" && body !== "") {
					init.method = "POST";
					h["Content-Type"] = "application/json; charset=utf-8";
					init.body = body;
				}
				const res = await fetch(url, init);
				const text = await res.text();
				if (!res.ok) throw new Error("http-" + res.status);
				return text;
			}
		}
	};
}

async function main() {
	// 来源域名覆盖由 verify.mjs（→ tools/check-domains.mjs）负责，这里是**单一权威实现**，
	// 不再在本文件重复一份，避免两处逻辑漂移。提交钩子会自动跑 verify.mjs，所以它必然被执行。
	// 单独跑：node tools/check-domains.mjs

	say("=== 1. 真网络抓取（与扩展同一份 transport 契约）===");
	// 直接跑已发布的 core 包（与扩展内联的是同一个版本）
	const corePkgPath = path.join(ROOT, "node_modules", "gacha-calendar-core", "package.json");
	const corePkg = JSON.parse(fs.readFileSync(corePkgPath, "utf8"));
	const { createEngine } = await import(pathToFileURL(path.join(path.dirname(corePkgPath), corePkg.main)).href);
	const { transport, log: reqLog } = makeTransport();
	const mem = new Map();
	const engine = createEngine({
		transport,
		storage: {
			async get(k) {
				return mem.get(k);
			},
			async set(k, v) {
				mem.set(k, v);
			}
		}
	});
	say(`  core 版本: ${corePkg.version}`);

	const games = await engine.listGames();
	// 条目数**不写死**：core 已从 11 款扩到 28 款，且用户可能删除条目，
	// 所以以 core 当前的出厂条目数为基准做断言。
	const factoryCount = engine.__test.SOURCES.length;
	const TOTAL = games.length;
	check(
		`listGames 返回全部出厂条目（${TOTAL}/${factoryCount}）`,
		TOTAL === factoryCount && factoryCount > 11,
		`${TOTAL} 款：${games.map((g) => g.name).join("、")}`
	);

	const t0 = Date.now();
	const result = await engine.refresh();
	const secs = ((Date.now() - t0) / 1000).toFixed(1);
	const ids = Object.keys(result.games);
	const has = (v) => typeof v === "string" && v.length > 0;
	const gachaOk = ids.filter((id) => has(result.games[id].banner)).length;
	const eventOk = ids.filter((id) => has(result.games[id].event)).length;
	const down = ids.filter((id) => result.games[id].gachaFail && result.games[id].gachaFail.kind === "down").length;
	say(`  请求 ${reqLog.length} 次，用时 ${secs}s；卡池 ${gachaOk}/${TOTAL}，活动 ${eventOk}/${TOTAL}，down=${down}`);
	check(`抓取覆盖全部 ${TOTAL} 款`, ids.length === TOTAL);
	// parserVersions 只覆盖「登记了 parserVersion 的条目」。实测 core 0.11.1 里只有原 11 款填了，
	// 新增的 17 款没填 —— 这是 core 侧的现状（新条目未登记解析器版本），不是扩展缺陷。
	// 所以只断言"是子集且非空"，并显式说明，避免误以为扩展丢了字段。
	const pvCount = Object.keys(result.parserVersions || {}).length;
	check(
		"契约字段齐全（schemaVersion 1 + parserVersions 非空子集）",
		result.schemaVersion === 1 && pvCount > 0 && pvCount <= TOTAL,
		`schemaVersion=${result.schemaVersion}，parserVersions ${pvCount}/${TOTAL} 项`
	);
	if (pvCount < TOTAL) {
		say(`  ⚠ 说明：core ${corePkg.version} 中仅 ${pvCount} 款登记了 parserVersion（新条目未登记），非扩展问题`);
	}
	// 注意：bwiki 会风控（连续请求返回 HTTP 567），触发时相关来源集体失败；
	// 另外 28 款里有若干来源本身不稳定。这是来源站问题，不是扩展缺陷，
	// 所以按"多数成功"设阈值；真正的正确性由下面的"渲染模型"断言保证（域名覆盖见 verify.mjs）
	const minOk = Math.ceil(TOTAL * 0.5);
	check(`卡池有内容 ≥ ${minOk} 款`, gachaOk >= minOk, `${gachaOk}/${TOTAL}`);
	check(`活动有内容 ≥ ${minOk} 款`, eventOk >= minOk, `${eventOk}/${TOTAL}`);

	say("\n=== 3. 缓存落盘（storage 契约）===");
	check("写入了 lastData", typeof mem.get("lastData") === "string" && mem.get("lastData").length > 0);
	check("写入了 lastRefresh", typeof mem.get("lastRefresh") === "number" && mem.get("lastRefresh") > 0);
	check("lastSource = web", mem.get("lastSource") === "web");
	const cached = await engine.getCached();
	check(`getCached 读回 ${TOTAL} 款`, Object.keys(cached.games).length === TOTAL, `${Object.keys(cached.games).length} 款`);

	say("\n=== 4. 渲染模型（与 popup 同一份纯函数）===");
	// 直接 import 扩展的 view-helpers 源码 —— 与 popup.js 用的是同一个文件
	const vh = await import(pathToFileURL(path.join(SRC, "view-helpers.js")).href);
	const now = new Date();
	const rows = games.map((g) => vh.buildRowModel(g, result.games[g.id] || vh.defaultRecord(g), now));
	check(`算出 ${TOTAL} 行`, rows.length === TOTAL);
	const cell = (r, k) => r[k] && r[k].value;
	const rowsGacha = rows.filter((r) => cell(r, "gacha") && cell(r, "gacha") !== "—").length;
	const rowsEvent = rows.filter((r) => cell(r, "event") && cell(r, "event") !== "—").length;
	say(`  卡池列有内容 ${rowsGacha} 行，活动列 ${rowsEvent} 行`);
	check(`卡池列有内容 ≥ ${minOk} 行`, rowsGacha >= minOk, `${rowsGacha} 行`);
	check(`活动列有内容 ≥ ${minOk} 行`, rowsEvent >= minOk, `${rowsEvent} 行`);
	// 行标题格式：有成功记录时是"名称\n刷新时间 …"；两侧都没抓到新数据时只有名称（这是正确行为）
	check(
		"行标题格式正确（名称 + 可选刷新时间）",
		rows.every((r) => r.title === r.name || (r.title.startsWith(r.name + "\n") && r.title.includes("刷新时间"))),
		rows.find((r) => r.title.includes("刷新时间"))?.title.split("\n").join(" / ") || rows[0].title
	);
	const cd = rows.map((r) => cell(r, "gachaDates")).find((v) => /还剩|还有|已结束/.test(v || ""));
	check("起止列渲染出倒计时", !!cd, cd || "无");
	check("悬停文案含池名+时间明细", rows.some((r) => (r.gacha.title || "").includes("\n")), "");
	check("悬停文案含时间原文（mm-dd）", rows.some((r) => /\d{2}-\d{2}/.test((r.gachaDates && r.gachaDates.title) || "")), "");
	// 角色名精简应生效（有 roles 时外显不含池名装饰）
	const roleRow = rows.find((r) => result.games[r.id].roles);
	if (roleRow) {
		check(
			"角色名精简生效（去「」与属性后缀）",
			!/[「」]/.test(cell(roleRow, "gacha") || ""),
			`${roleRow.name}: ${cell(roleRow, "gacha")}`
		);
	}

	say("\n=== 5. 顶部提示（core 的 buildScrapeInfo 调用口径）===");
	const info = vh.buildScrapeInfo(games.map((g) => ({ id: g.id, name: g.name })), result);
	check("生成「成功 N/M」提示", new RegExp("成功\\s+\\d+/" + TOTAL).test(info.info), info.info);
	check("失败分类明细为数组", Array.isArray(info.lines));

	say("\n=== 逐款结果 ===");
	for (const [id, g] of Object.entries(result.games)) {
		const f = [
			g.gachaFail ? `卡池:${g.gachaFail.kind}${g.gachaFail.reason ? "(" + g.gachaFail.reason + ")" : ""}` : "",
			g.eventFail ? `活动:${g.eventFail.kind}${g.eventFail.reason ? "(" + g.eventFail.reason + ")" : ""}` : ""
		].filter(Boolean).join(" ");
		say(`  ${id.padEnd(14)} ${(g.banner || "—").slice(0, 24).padEnd(24)} ${(g.event || "—").slice(0, 20).padEnd(20)} ${f}`);
	}

	say("");
	if (failed) {
		say(`✗ ${failed} 项未通过`);
		fs.writeFileSync(path.join(ROOT, "_live-verify.txt"), log.join("\n") + "\n", "utf8");
		process.exit(1);
	}
	say(`✓ 端到端验证通过（${TOTAL} 款实抓 + 渲染模型）`);
	fs.writeFileSync(path.join(ROOT, "_live-verify.txt"), log.join("\n") + "\n", "utf8");
}

main().catch((err) => {
	say("✗ 脚本异常: " + String((err && err.stack) || err));
	fs.writeFileSync(path.join(ROOT, "_live-verify.txt"), log.join("\n") + "\n", "utf8");
	process.exit(1);
});
