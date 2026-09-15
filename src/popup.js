// popup：二游排期面板。
//
// 数据全部来自 gacha-calendar-core 的引擎（抓取/解析/缓存合并都在 core 里）；
// 本文件只做两件事：**读引擎返回的 Result JSON** 和 **把它画成 DOM**。
// 展示口径（倒计时、角色名精简、悬停文案）见 view-helpers.js。

import { createEngine } from "gacha-calendar-core";
import { createStorage, readKeys } from "./storage.js";
import { transport } from "./transport.js";
import { buildRowModel, defaultRecord, buildScrapeInfo } from "./view-helpers.js";

const engine = createEngine({ transport, storage: createStorage() });

/** 默认配置（与 core 的 DEFAULT_SETTINGS 对齐；这里只需 UI 用到的那几项）。 */
const DEFAULT_REFRESH_MINUTES = 24 * 60;

const el = {
	list: document.getElementById("list"),
	status: document.getElementById("status"),
	scrape: document.getElementById("scrape"),
	refreshed: document.getElementById("refreshed"),
	refresh: document.getElementById("refresh"),
	settings: document.getElementById("settings")
};

/** 内存中的当前视图状态。 */
let state = {
	games: [],      // listGames() 的元信息，已按 order 排好
	records: {},    // Result JSON 的 games（id → record）
	refreshedAt: 0,
	lastSource: "none",
	scrapeInfo: "",
	scrapeLines: []
};

// 每分钟刷新一次"还剩 X 天 X 小时"的倒计时（与 DSH 面板同频）
let now = new Date();
setInterval(() => {
	now = new Date();
	renderList();
}, 60000);

// —— 数据读取 ——

/** 按设置里的 order 重排条目；未设置时保持 core 给的顺序。 */
function applyOrder(games, order) {
	if (!Array.isArray(order) || order.length === 0) return games;
	const byId = new Map(games.map((g) => [g.id, g]));
	const out = [];
	for (const id of order) if (byId.has(id)) out.push(byId.get(id));
	for (const g of games) if (!out.includes(g)) out.push(g);
	return out;
}

/** 读一次设置 + 缓存，刷新内存状态。 */
async function loadState() {
	const [games, cached, cfg] = await Promise.all([
		engine.listGames(),
		engine.getCached(),
		readKeys(["order", "hidden", "lastSource", "refreshMinutes", "autoRefresh"])
	]);
	const order = Array.isArray(cfg.order) ? cfg.order : [];
	const hidden = Array.isArray(cfg.hidden) ? cfg.hidden : [];
	state.games = applyOrder(games, order).filter((g) => !hidden.includes(g.id));
	state.records = cached.games || {};
	state.refreshedAt = cached.refreshedAt || 0;
	state.lastSource = cfg.lastSource || "none";
	state.refreshMinutes = Number(cfg.refreshMinutes) || DEFAULT_REFRESH_MINUTES;
	state.autoRefresh = cfg.autoRefresh !== false;
}

// —— 渲染 ——
// 展示逻辑全部来自 view-helpers 的纯函数 buildRowModel（与自动化验证跑的是同一份），
// 本文件只负责把它的结果落成 DOM。

function fmtTime(ts) {
	return ts ? new Date(ts).toLocaleString() : "—";
}

/** 一行的取值：缓存没有该条时就退回条目自带的静态默认值。 */
function recordFor(game) {
	return state.records[game.id] || defaultRecord(game);
}

function renderList() {
	if (state.games.length === 0) {
		el.list.innerHTML = '<p class="empty">没有可显示的条目：请到设置页检查「展示」开关。</p>';
		return;
	}
	const frag = document.createDocumentFragment();
	for (const game of state.games) {
		const row = buildRowModel(game, recordFor(game), now);

		const box = document.createElement("div");
		box.className = "game";

		// 第一行：图标 + 名称 + 状态徽标
		const top = document.createElement("div");
		top.className = "game-top";
		const img = document.createElement("img");
		img.src = row.icon;
		img.alt = "";
		img.loading = "lazy";
		top.appendChild(img);

		const name = document.createElement("div");
		name.className = "game-name";
		name.textContent = row.name;
		name.title = row.title;
		top.appendChild(name);

		const badge = row.badge || row.staleBadge;
		if (badge) {
			const b = document.createElement("span");
			b.className = "badge" + (badge.cls ? " " + badge.cls : "");
			b.textContent = badge.text;
			b.title = row.title;
			top.appendChild(b);
		}
		box.appendChild(top);

		// 卡池 / 起止 / 活动 / 起止
		box.appendChild(makeLine("卡池", row.gacha.value, row.gacha.title, "strong"));
		box.appendChild(makeLine("起止", row.gachaDates.value, row.gachaDates.title, "plain"));
		box.appendChild(makeLine("活动", row.event.value, row.event.title, ""));
		box.appendChild(makeLine("起止", row.eventDates.value, row.eventDates.title, "plain"));

		frag.appendChild(box);
	}
	el.list.replaceChildren(frag);
}

function makeLine(key, value, title, extraClass) {
	const line = document.createElement("div");
	line.className = "line";
	const k = document.createElement("span");
	k.className = "k";
	k.textContent = key;
	const v = document.createElement("span");
	v.className = "v" + (extraClass ? " " + extraClass : "");
	v.textContent = value || "—";
	if (title) v.title = title;
	line.append(k, v);
	return line;
}

function renderHeader() {
	// 成功数口径与 core 的 buildScrapeInfo 保持一致：两侧都没有"报错"（down）才算成功
	const total = state.games.length;
	const okCount = state.games.filter((g) => {
		const rec = state.records[g.id];
		if (!rec || rec.skipped) return false;
		return !(rec.gachaFail && rec.gachaFail.kind === "down") && !(rec.eventFail && rec.eventFail.kind === "down");
	}).length;
	const dataStatus = state.lastSource === "web" ? "联网数据" : "—";
	el.status.textContent = `数据：${dataStatus} · 成功 ${okCount}/${total}`;
	el.refreshed.textContent = "更新：" + fmtTime(state.refreshedAt);
	if (state.scrapeInfo) {
		el.scrape.hidden = false;
		el.scrape.textContent = state.scrapeInfo;
		el.scrape.title = state.scrapeLines.join("\n");
	} else {
		el.scrape.hidden = true;
	}
}

async function render() {
	await loadState();
	renderHeader();
	renderList();
}

// —— 抓取 ——

async function doRefresh() {
	if (el.refresh.disabled) return;
	el.refresh.disabled = true;
	el.refresh.firstElementChild.classList.add("spin");
	el.status.textContent = "刷新中…";
	try {
		const result = await engine.refresh();
		// 顶部提示：只读 Result JSON，按显示顺序交给 core 的归类函数
		const ordered = state.games.map((g) => ({ id: g.id, name: g.name }));
		const { info, lines } = buildScrapeInfo(ordered, result);
		state.scrapeInfo = info;
		state.scrapeLines = lines;
		await loadState();
		renderHeader();
		renderList();
	} catch (err) {
		el.status.textContent = "刷新失败：" + String((err && err.message) || err);
	} finally {
		el.refresh.disabled = false;
		el.refresh.firstElementChild.classList.remove("spin");
	}
}

/** 打开 popup 时按设置的频率判断是否需要自动抓一轮（避免每次点开都联网）。 */
async function autoRefreshIfDue() {
	if (!state.autoRefresh) return;
	const intervalMs = Math.max(1, state.refreshMinutes) * 60 * 1000;
	const due = !state.refreshedAt || Date.now() - state.refreshedAt >= intervalMs;
	// 完全没有缓存时也抓一次（首次使用）
	const empty = Object.keys(state.records).length === 0;
	if (due || empty) await doRefresh();
}

// —— 入口 ——

el.refresh.addEventListener("click", () => doRefresh());
el.settings.addEventListener("click", () => chrome.runtime.openOptionsPage());

(async () => {
	await render();
	// 先渲染缓存（立即出内容），再视情况后台抓一轮
	await autoRefreshIfDue();
})().catch((err) => {
	el.status.textContent = "启动失败：" + String((err && err.message) || err);
	el.list.innerHTML = '<p class="empty">载入失败，请打开设置页重试。</p>';
});
