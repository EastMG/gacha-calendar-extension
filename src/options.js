// options：设置页。
//
// 与 DSH 插件同键名（order / hidden / removed / refreshMinutes / autoRefresh /
// customUrls / customEventUrls / customEntries），所以两份配置语义一致、可互相照抄。
// 本页只读写设置，不参与抓取 —— 抓取一律经 core 引擎。

import { createEngine } from "gacha-calendar-core";
import { createStorage, readKeys, writeKeys } from "./storage.js";
import { transport } from "./transport.js";

const engine = createEngine({ transport, storage: createStorage() });

// 刷新频率选项（分钟）——与 DSH 插件一致的按天档位
const REFRESH_OPTIONS = [
	{ label: "1 天", minutes: 1 * 24 * 60 },
	{ label: "5 天", minutes: 5 * 24 * 60 },
	{ label: "7 天", minutes: 7 * 24 * 60 },
	{ label: "15 天", minutes: 15 * 24 * 60 },
	{ label: "24 天", minutes: 24 * 24 * 60 },
	{ label: "30 天", minutes: 30 * 24 * 60 },
	{ label: "42 天", minutes: 42 * 24 * 60 }
];

const el = {
	count: document.getElementById("count"),
	entries: document.getElementById("entries"),
	autoRefresh: document.getElementById("autoRefresh"),
	refreshMinutes: document.getElementById("refreshMinutes"),
	resetOrder: document.getElementById("resetOrder"),
	selfCheck: document.getElementById("selfCheck"),
	scSummary: document.getElementById("sc-summary"),
	scList: document.getElementById("sc-list"),
	ver: document.getElementById("ver"),
	coreVer: document.getElementById("core-ver")
};

/** 当前设置快照（内存态；每次改动后落盘并重渲染）。 */
let cfg = {
	order: [],
	hidden: [],
	removed: [],
	customEntries: "[]",
	customUrls: "{}",
	customEventUrls: "{}",
	autoRefresh: true,
	refreshMinutes: 24 * 60
};
let allGames = [];

// —— 工具 ——

function parseJson(raw, fallback) {
	try {
		const v = JSON.parse(raw || "");
		return v === null || v === undefined ? fallback : v;
	} catch {
		return fallback;
	}
}

/** 保存若干键（值按 core 的存储约定：customUrls/customEventUrls/customEntries 存 JSON 字符串）。 */
async function commit(patch) {
	Object.assign(cfg, patch);
	const out = { ...patch };
	// 这三个键 core 按 JSON 字符串读取
	for (const k of ["customUrls", "customEventUrls", "customEntries"]) {
		if (k in out && typeof out[k] !== "string") out[k] = JSON.stringify(out[k]);
	}
	await writeKeys(out);
	render();
}

/** 默认来源显示名（与 DSH 同口径）：source 标签 > 域名 > 未配置。 */
function defaultSourceName(game, isEvent) {
	const label = isEvent ? game.eventSource : game.source;
	if (label && label.trim() !== "") return label.trim();
	return "默认来源";
}

/** 当前选中的来源值：无键=默认；"custom:" 前缀=自定义；其它=备选源值。 */
function urlMode(urls, id) {
	if (!Object.prototype.hasOwnProperty.call(urls, id)) return "default";
	const v = urls[id];
	if (typeof v === "string" && v.startsWith("custom:")) return "custom";
	return v;
}

/** 可见顺序：order 里没有的条目按 core 的顺序补在后面。 */
function orderedGames() {
	const base = allGames.slice();
	if (!Array.isArray(cfg.order) || cfg.order.length === 0) return base;
	const byId = new Map(base.map((g) => [g.id, g]));
	const out = [];
	for (const id of cfg.order) if (byId.has(id)) out.push(byId.get(id));
	for (const g of base) if (!out.includes(g)) out.push(g);
	return out;
}

// —— 渲染 ——

function render() {
	const order = orderedGames();
	el.count.textContent = String(allGames.length);
	el.autoRefresh.checked = cfg.autoRefresh !== false;
	renderRefreshOptions();

	const frag = document.createDocumentFragment();
	order.forEach((game, i) => frag.appendChild(renderEntry(game, i, order)));
	el.entries.replaceChildren(frag);
}

function renderRefreshOptions() {
	const current = Number(cfg.refreshMinutes) || 24 * 60;
	const inOptions = REFRESH_OPTIONS.some((o) => o.minutes === current);
	const opts = inOptions ? REFRESH_OPTIONS.slice() : [{ label: `自定义（${current} 分钟）`, minutes: current }, ...REFRESH_OPTIONS];
	el.refreshMinutes.replaceChildren(
		...opts.map((o) => {
			const op = document.createElement("option");
			op.value = String(o.minutes);
			op.textContent = o.label;
			return op;
		})
	);
	el.refreshMinutes.value = String(current);
}

function renderEntry(game, index, order) {
	const urls = parseJson(cfg.customUrls, {});
	const eventUrls = parseJson(cfg.customEventUrls, {});
	const row = document.createElement("div");
	row.className = "entry";

	// 游戏名 + 图标
	const name = document.createElement("div");
	name.className = "g-name";
	const img = document.createElement("img");
	img.src = game.icon;
	img.alt = "";
	name.appendChild(img);
	const span = document.createElement("span");
	span.textContent = game.name;
	span.title = game.custom ? game.name + "（自定义条目）" : game.name;
	name.appendChild(span);
	row.appendChild(name);

	// 展示开关
	const showCell = document.createElement("div");
	showCell.className = "cell-center";
	const cb = document.createElement("input");
	cb.type = "checkbox";
	cb.checked = !cfg.hidden.includes(game.id);
	cb.title = "是否在面板中显示";
	cb.addEventListener("change", () => {
		const next = cfg.hidden.includes(game.id)
			? cfg.hidden.filter((x) => x !== game.id)
			: [...cfg.hidden, game.id];
		commit({ hidden: next });
	});
	showCell.appendChild(cb);
	row.appendChild(showCell);

	// 卡池来源
	row.appendChild(renderSourceSelect(game, urls, false));
	// 活动来源
	row.appendChild(renderSourceSelect(game, eventUrls, true));

	// 操作：上移 / 下移
	const ops = document.createElement("div");
	ops.className = "ops";
	const ids = order.map((g) => g.id);
	const up = document.createElement("button");
	up.type = "button";
	up.className = "btn mini";
	up.textContent = "↑";
	up.title = "上移";
	up.disabled = index === 0;
	up.addEventListener("click", () => move(ids, game.id, -1));
	const down = document.createElement("button");
	down.type = "button";
	down.className = "btn mini";
	down.textContent = "↓";
	down.title = "下移";
	down.disabled = index === order.length - 1;
	down.addEventListener("click", () => move(ids, game.id, 1));
	ops.append(up, down);
	row.appendChild(ops);
	return row;
}

function renderSourceSelect(game, urls, isEvent) {
	const sel = document.createElement("select");
	sel.className = "cell-center";
	const alts = (isEvent ? game.eventAltSources : game.altSources) || [];
	const mode = urlMode(urls, game.id);

	const add = (value, label) => {
		const op = document.createElement("option");
		op.value = value;
		op.textContent = label;
		sel.appendChild(op);
	};
	add("default", defaultSourceName(game, isEvent));
	for (const a of alts) add(a.value, a.label);
	add("custom", "自定义…");

	sel.value = alts.some((a) => a.value === mode) ? mode : mode === "default" ? "default" : mode;
	// 模式不在选项里（例如自定义 URL 已被清空）时回落到默认
	if (![...sel.options].some((o) => o.value === sel.value)) sel.value = "default";

	sel.addEventListener("change", () => {
		const key = isEvent ? "customEventUrls" : "customUrls";
		const next = { ...parseJson(cfg[key], {}) };
		if (sel.value === "default") {
			delete next[game.id];
			commit({ [key]: next });
			return;
		}
		if (sel.value === "custom") {
			const cur = typeof urls[game.id] === "string" && urls[game.id].startsWith("custom:")
				? urls[game.id].slice("custom:".length)
				: "";
			const input = window.prompt(isEvent ? "活动来源地址（网页 URL）" : "卡池来源地址（网页 URL）", cur);
			if (input === null) {
				sel.value = "default";
				return;
			}
			next[game.id] = "custom:" + input.trim();
			commit({ [key]: next });
			return;
		}
		next[game.id] = sel.value;
		commit({ [key]: next });
	});
	return sel;
}

async function move(ids, id, delta) {
	const idx = ids.indexOf(id);
	const target = idx + delta;
	if (idx < 0 || target < 0 || target >= ids.length) return;
	const next = ids.slice();
	next.splice(idx, 1);
	next.splice(target, 0, id);
	await commit({ order: next });
}

// —— 自检 ——

async function runSelfCheck() {
	el.selfCheck.disabled = true;
	el.selfCheck.textContent = "自检中…";
	el.scSummary.textContent = "";
	el.scList.replaceChildren();
	const started = Date.now();
	try {
		const report = await engine.selfCheck();
		const secs = ((Date.now() - started) / 1000).toFixed(1);
		const s = report.summary || {};
		el.scSummary.textContent = `共 ${report.total} 个条目 · 来源结论：正常 ${s.ok || 0} / 未公布 ${s.nomatch || 0} / 报错 ${s.down || 0} · 用时 ${secs}s`;
		const items = [];
		if (!report.problems || report.problems.length === 0) {
			items.push({ text: "✓ 所有来源都能解析出当期内容", cls: "ok" });
		} else {
			for (const p of report.problems) items.push({ text: p, cls: "bad" });
		}
		el.scList.replaceChildren(
			...items.map((it) => {
				const li = document.createElement("li");
				li.className = it.cls;
				li.textContent = it.text;
				return li;
			})
		);
	} catch (err) {
		el.scSummary.textContent = "自检失败：" + String((err && err.message) || err);
	} finally {
		el.selfCheck.disabled = false;
		el.selfCheck.textContent = "重新自检";
	}
}

// —— 入口 ——

el.autoRefresh.addEventListener("change", () => commit({ autoRefresh: el.autoRefresh.checked }));
el.refreshMinutes.addEventListener("change", () => commit({ refreshMinutes: Number(el.refreshMinutes.value) }));
el.resetOrder.addEventListener("click", () => commit({ order: null }));
el.selfCheck.addEventListener("click", () => runSelfCheck());

(async () => {
	const manifest = chrome.runtime.getManifest();
	el.ver.textContent = manifest.version;
	// core 版本：从扩展自身的依赖元信息里取（构建时写入）
	try {
		const mod = await import("./core-version.js");
		el.coreVer.textContent = mod.CORE_VERSION;
	} catch {
		el.coreVer.textContent = "—";
	}

	const [games, stored] = await Promise.all([
		engine.listGames(),
		readKeys(["order", "hidden", "removed", "customEntries", "customUrls", "customEventUrls", "autoRefresh", "refreshMinutes"])
	]);
	allGames = games;
	cfg = {
		order: Array.isArray(stored.order) ? stored.order : [],
		hidden: Array.isArray(stored.hidden) ? stored.hidden : [],
		removed: Array.isArray(stored.removed) ? stored.removed : [],
		customEntries: typeof stored.customEntries === "string" ? stored.customEntries : "[]",
		customUrls: typeof stored.customUrls === "string" ? stored.customUrls : "{}",
		customEventUrls: typeof stored.customEventUrls === "string" ? stored.customEventUrls : "{}",
		autoRefresh: stored.autoRefresh !== false,
		refreshMinutes: Number(stored.refreshMinutes) || 24 * 60
	};
	render();
})().catch((err) => {
	el.count.textContent = "载入失败：" + String((err && err.message) || err);
});
