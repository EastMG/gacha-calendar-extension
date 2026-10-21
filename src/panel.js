// 新日程面板（实验特性）的页面宿主。
//
// 组件本身（src/schedule/schedule-view.js）是从 DSH 插件**一比一**移植来的 React 组件；
// 本文件只负责三件事：给组件喂数据、接住它的两个回调（刷新）、把它挂到页面上。
//
// 为什么用独立页面而不是 popup：新面板是"整块日程视图"，设计宽度 690px、高度随 28 条
// 条目增长（实测约 1100px），远超浏览器 popup 的尺寸上限（约 800×600）。
// 放进 popup 会把设计压变形，因此改由工具栏按钮直接打开本页面。

import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { createEngine } from "gacha-calendar-core";
import { createStorage, readKeys } from "./storage.js";
import { transport } from "./transport.js";
import { createVisibility } from "./visibility.js";
import { sourceTable } from "./entry-meta.js";
import { buildScrapeInfo } from "./view-helpers.js";
import { ScheduleView } from "./schedule/schedule-view.js";

const engine = createEngine({ transport, storage: createStorage() });

// 宿主形态：工具栏 popup（520×600）或独立页面（宽、不限高）。
// popup 里高度只有 600px，「近期」每批只显示 3 条，给下面的游戏表留空间。
// 「近期」默认最多显示 2 条（展开后仍可看全部）。
const NEAR_LIMIT = 2;
const DEFAULT_REFRESH_MINUTES = 24 * 60;

const state = {
	/** 已按 order 排序、过滤掉隐藏项，并合并了抓取结果的条目（形状与插件一致）。 */
	games: [],
	refreshedAt: 0,
	lastSource: "none",
	refreshMinutes: DEFAULT_REFRESH_MINUTES,
	autoRefresh: true,
	gameColors: "{}",
	/** 顶部区域二选一："recent" 近期列表 / "slot" 近期卡片（设置页切换） */
	panelTop: "recent",
	scrapeInfo: "",
	scrapeLines: [],
	refreshing: false
};

const rootEl = document.getElementById("root");
const reactRoot = createRoot(rootEl);

/** 按设置里的 order 重排条目；未设置时保持 core 给的顺序（与 popup 同口径）。 */
function applyOrder(games, order) {
	if (!Array.isArray(order) || order.length === 0) return games;
	const byId = new Map(games.map((g) => [g.id, g]));
	const out = [];
	for (const id of order) if (byId.has(id)) out.push(byId.get(id));
	for (const g of games) if (!out.includes(g)) out.push(g);
	return out;
}

/**
 * 把 listGames() 的元信息与缓存结果合成面板要的条目形状。
 *
 * 这一步对应插件 CalendarPanel 里 `visible → games` 那段合并：引擎只给"外显一条 + 悬停多行"，
 * 面板需要 banner/event/roles/dates/hover 与失败状态平铺在同一对象上。
 */
function mergeGames(list, records, order, vis, colorOverrides) {
	const table = sourceTable(engine);
	return applyOrder(list, order)
		.filter((g) => !vis.isHidden(g.id))
		.map((g) => {
			const src = table.get(g.id) || {};
			// tz 参与"源站墙钟 → 本机时区"的换算；color 是每游戏的出厂主题色
			let out = { ...g, tz: src.tz || g.tz, color: src.color || g.color };
			const ov = colorOverrides[g.id];
			if (/^#[0-9a-f]{6}$/i.test(String(ov || ""))) out = { ...out, color: String(ov) };
			const sc = records[g.id];
			if (!sc) return out;
			return {
				...out,
				_okAt: sc.okAt || 0,
				gachaFail: sc.gachaFail || null,
				eventFail: sc.eventFail || null,
				gachaStale: !!(sc.gachaStale || sc.stale),
				eventStale: !!(sc.eventStale || sc.stale),
				banner: sc.banner || out.banner,
				roles: sc.roles || out.roles || "",
				bannerDates: sc.bannerDates || out.bannerDates,
				bannerDatesRaw: sc.bannerDatesRaw || "",
				bannerHover: sc.bannerHover || "",
				event: sc.event || out.event,
				eventDates: sc.eventDates || out.eventDates,
				eventDatesRaw: sc.eventDatesRaw || "",
				eventHover: sc.eventHover || ""
			};
		});
}

function parseJson(str, fallback) {
	try { return JSON.parse(str || "") ?? fallback; } catch { return fallback; }
}

/** 读一次设置 + 缓存，重算视图数据。 */
async function loadState() {
	const [list, cached, cfg] = await Promise.all([
		engine.listGames(),
		engine.getCached(),
		readKeys([
			"order", "hidden", "shown", "removed", "customEntries", "customUrls", "customEventUrls",
			"gameColors", "panelTop", "refreshMinutes", "autoRefresh", "lastSource"
		])
	]);
	const order = Array.isArray(cfg.order) ? cfg.order : [];
	const vis = createVisibility(engine, cfg);
	const colorOverrides = parseJson(cfg.gameColors, {});
	const records = cached.games || {};

	state.games = mergeGames(list, records, order, vis, colorOverrides);
	state.refreshedAt = cached.refreshedAt || 0;
	state.lastSource = cfg.lastSource || "none";
	state.refreshMinutes = Number(cfg.refreshMinutes) || DEFAULT_REFRESH_MINUTES;
	state.autoRefresh = cfg.autoRefresh !== false;
	state.gameColors = typeof cfg.gameColors === "string" ? cfg.gameColors : "{}";
	state.panelTop = cfg.panelTop === "slot" ? "slot" : "recent";

	// 底部横幅：优先用本轮刷新的结果，没有就用缓存里的最近一次结果算出来
	const ordered = state.games.map((g) => ({ id: g.id, name: g.name }));
	const info = buildScrapeInfo(ordered, cached);
	state.scrapeInfo = info.info;
	state.scrapeLines = info.lines;
}

// —— 渲染 ——
// 「每分钟一次」的时钟：驱动倒计时与「上次更新 X 分钟前」，与插件同频。
let now = new Date();
function tick() {
	now = new Date();
	render();
}

function render() {
	reactRoot.render(createElement(ScheduleView, {
		games: state.games,
		now,
		s: { gameColors: state.gameColors, lastRefresh: state.refreshedAt },
		colorMap: parseJson(state.gameColors, {}),
		refreshing: state.refreshing,
		onRefresh: doRefresh,
		lastRefreshText: state.refreshedAt ? new Date(state.refreshedAt).toLocaleString() : "—",
		scrapeInfo: state.scrapeInfo,
		scrapeLines: state.scrapeLines,
		// 扩展侧改版的两个开关（见 schedule-view.js 顶部说明）
		topMode: state.panelTop,
		stacked: true,
		// 仅 popup 下收窄「近期」批次（独立页面保持 10）
		nearLimit: NEAR_LIMIT
	}));
}

// —— 抓取 ——

async function doRefresh() {
	if (state.refreshing) return;
	state.refreshing = true;
	render();
	try {
		const result = await engine.refresh();
		await loadState();
		// 刷新成功后用这一轮的结果重算底部横幅（loadState 用的是缓存，两者一致，但这里更准）
		const ordered = state.games.map((g) => ({ id: g.id, name: g.name }));
		const info = buildScrapeInfo(ordered, result);
		state.scrapeInfo = info.info;
		state.scrapeLines = info.lines;
	} catch (err) {
		state.scrapeInfo = "刷新失败：" + String((err && err.message) || err);
		state.scrapeLines = [];
	} finally {
		state.refreshing = false;
		now = new Date();
		render();
	}
}

/** 打开页面时按设置的频率判断是否需要自动抓一轮（与 popup 同口径，避免每次打开都联网）。 */
async function autoRefreshIfDue() {
	if (!state.autoRefresh) return;
	const intervalMs = Math.max(1, state.refreshMinutes) * 60 * 1000;
	const due = !state.refreshedAt || Date.now() - state.refreshedAt >= intervalMs;
	if (due) await doRefresh();
}

// —— 入口 ——

(async () => {
	await loadState();
	render();
	setInterval(tick, 60000);
	await autoRefreshIfDue();
})().catch((err) => {
	rootEl.textContent = "载入失败：" + String((err && err.message) || err);
});
