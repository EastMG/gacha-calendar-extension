// 启动自检（**只在 `node build.mjs --verify` 时打进 background.js**，正常构建不含）。
//
// 用途：
//   1. 自动化验证：service worker 一定会随扩展加载而执行，是"扩展真的能跑"的最可靠证据。
//      它跑完把结构化报告写进 chrome.storage.local（不依赖网络），验证脚本再从 profile 的
//      LevelDB 里读回来 —— 这条通路绕开 CDP 与 localhost 网络两个不可靠环节。
//   2. 排查工具：源站改版时，用同样的思路能快速定位"哪个源解析出 0 条、哪个源 403"。
//
// 注意：这是**验证专用**代码，不能出现在上架包里（正常构建不会产出它）。
import { createEngine } from "gacha-calendar-core";
import { transport } from "./transport.js";
import { buildRowModel, defaultRecord, buildScrapeInfo } from "./view-helpers.js";

/** service worker 没有 window/localStorage，用内存 Map 顶替（只影响自检）。 */
function memStorage() {
	const m = new Map();
	return {
		async get(k) {
			return m.get(k);
		},
		async set(k, v) {
			m.set(k, v);
		}
	};
}

/** 把报告写进 chrome.storage.local（**先落盘**；网络回传是可选的加分项）。 */
function report(payload) {
	const json = JSON.stringify(payload);
	try {
		chrome.storage.local.set({ __verify_report: json, __verify_at: Date.now() });
	} catch {
		/* 存储不可用也不能影响流程 */
	}
	// 可选：网络回传。必须彻底吞异常，否则 catch 里再发请求会变成无限递归（本项目踩过这个坑）。
	try {
		fetch("http://127.0.0.1:8777/report", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: json
		}).catch(() => {});
	} catch {
		/* 允许失败：报告已落盘 */
	}
	return Promise.resolve();
}

async function runSelfTest() {
	const engine = createEngine({ transport, storage: memStorage() });
	const out = { at: Date.now(), where: "service_worker", steps: {} };

	// 0. 环境自证
	try {
		const mf = chrome.runtime.getManifest();
		out.steps.env = {
			ok: true,
			manifestVersion: mf.manifest_version,
			name: mf.name,
			version: mf.version,
			hostCount: (mf.host_permissions || []).length,
			hasStorage: typeof chrome.storage?.local?.get === "function"
		};
	} catch (e) {
		out.steps.env = { ok: false, error: String((e && e.message) || e) };
	}

	// 1. 条目元信息
	let games = [];
	try {
		games = await engine.listGames();
		out.steps.listGames = {
			ok: games.length === 11,
			count: games.length,
			names: games.map((g) => g.name),
			ids: games.map((g) => g.id)
		};
	} catch (e) {
		out.steps.listGames = { ok: false, error: String((e && e.message) || e) };
	}

	// 2. 直连通道（CORS 放行的源）
	try {
		const res = await transport.fetchRaw("https://api-web.bluearchive.jp/api/news/list?pageIndex=1&pageNum=5", {});
		const text = await res.text();
		out.steps.rawOk = { ok: res.ok === true, status: res.status, len: text.length };
	} catch (e) {
		out.steps.rawOk = { ok: false, error: String((e && e.message) || e) };
	}

	// 3. 代发通道（没有 ACAO 的源）
	try {
		const body = await transport.fetchViaProxy("https://yh.wanmei.com/news/gamebroad/", {
			referer: "https://yh.wanmei.com/"
		});
		out.steps.proxyOk = { ok: typeof body === "string" && body.length > 1000, len: body.length };
	} catch (e) {
		out.steps.proxyOk = { ok: false, error: String((e && e.message) || e) };
	}

	// 4. 真抓一轮（与 popup 走同一条 transport）
	try {
		const t0 = Date.now();
		const result = await engine.refresh();
		const ids = Object.keys(result.games);
		const has = (v) => typeof v === "string" && v.length > 0;
		out.steps.refresh = {
			ok: ids.length === 11,
			elapsedMs: Date.now() - t0,
			schemaVersion: result.schemaVersion,
			parserVersionCount: Object.keys(result.parserVersions || {}).length,
			total: ids.length,
			gacha: ids.filter((id) => has(result.games[id].banner)).length,
			event: ids.filter((id) => has(result.games[id].event)).length,
			down: ids.filter((id) => result.games[id].gachaFail && result.games[id].gachaFail.kind === "down").length,
			games: Object.fromEntries(
				ids.map((id) => [
					id,
					{
						name: result.games[id].name,
						banner: result.games[id].banner,
						event: result.games[id].event,
						gachaFail: result.games[id].gachaFail,
						eventFail: result.games[id].eventFail
					}
				])
			)
		};
		// 5. 用**面板同一份纯函数**算出每行显示什么（渲染模型的真值）
		const now = new Date();
		const rows = games.map((g) => buildRowModel(g, result.games[g.id] || defaultRecord(g), now));
		out.steps.rows = {
			ok: rows.length === 11,
			count: rows.length,
			rows: rows.map((r) => ({
				name: r.name,
				gacha: r.gacha.value,
				gachaDates: r.gachaDates.value,
				event: r.event.value,
				badge: r.badge ? r.badge.text : ""
			}))
		};
		out.steps.scrapeInfo = buildScrapeInfo(games.map((g) => ({ id: g.id, name: g.name })), result);
	} catch (e) {
		out.steps.refresh = { ok: false, error: String((e && e.message) || e) };
	}

	await report(out);
}

// 先报"已启动"（这一条就能证明 service worker 真的执行了），再跑正式自检
report({ at: Date.now(), boot: true, where: "service_worker" }).then(runSelfTest);
