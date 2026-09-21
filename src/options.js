// options：设置页。
//
// 与 DSH 插件同键名（order / hidden / removed / refreshMinutes / autoRefresh /
// customUrls / customEventUrls / customEntries），两份配置语义一致，可互相照抄。
// 本页只读写设置，不参与抓取 —— 抓取一律经 core 引擎。
//
// 关于"自定义条目"：本页不提供新增自定义条目的界面。原因是浏览器扩展的 host_permissions
// 是**构建期静态声明**的，运行期无法添加；而自定义条目指向的地址几乎必然落在声明列表之外，
// 结果会是"填了却抓不到、也不报错"。自定义来源地址（在已声明主机范围内）仍可逐条设置。

import { createEngine } from "gacha-calendar-core";
import { createStorage, readKeys, writeKeys } from "./storage.js";
import { transport } from "./transport.js";

const engine = createEngine({ transport, storage: createStorage() });

/** 刷新频率选项（分钟）——与 DSH 插件一致的按天档位。 */
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
	allowedHosts: document.getElementById("allowed-hosts"),
	autoRefresh: document.getElementById("autoRefresh"),
	refreshMinutes: document.getElementById("refreshMinutes"),
	resetOrder: document.getElementById("resetOrder"),
	removedCard: document.getElementById("removed-card"),
	removedList: document.getElementById("removed-list"),
	selfCheck: document.getElementById("selfCheck"),
	scSummary: document.getElementById("sc-summary"),
	scList: document.getElementById("sc-list"),
	ver: document.getElementById("ver"),
	coreVer: document.getElementById("core-ver")
};

/** 当前设置快照（内存态；每次改动后落盘并重渲染）。
 *  类型约定见 commit()：这里一律是自然类型（数组/对象），不是 JSON 字符串。 */
let cfg = {
	order: [],
	hidden: [],
	removed: [],
	customEntries: [],
	customUrls: {},
	customEventUrls: {},
	autoRefresh: true,
	refreshMinutes: 24 * 60
};
/** 生效中的条目（core 已按 removed 过滤）元信息。 */
let allGames = [];
/** 主机白名单（来自 manifest，供自定义地址输入框提示可选范围）。 */
let allowedHosts = [];

// —— 工具 ——

/**
 * 内置条目 id → 显示名。
 *
 * 为什么需要：条目被删除后，core 的 `listGames()` 不再返回它（core 按 `removed` 过滤），
 * 「已删除的条目」列表就只剩一串 id，界面上没法看。
 *
 * 实现取运行时来源：core 的引擎在 `__test.SOURCES` 上暴露了完整内置来源表（含被删除项），
 * 直接读它 —— 比在本文件维护一份快照稳得多，core 增删游戏时无需同步。
 * 万一该内部字段将来消失，退化为显示 id（不会崩）。
 */
function builtinNameMap() {
	const map = new Map();
	try {
		const sources = engine && engine.__test && engine.__test.SOURCES;
		if (Array.isArray(sources)) {
			for (const s of sources) {
				if (s && typeof s.id === "string") map.set(s.id, s.name || s.id);
			}
		}
	} catch {
		/* 找不到就退化为显示 id */
	}
	return map;
}

/** 持久化为 JSON 字符串的三个键（chrome.storage 里存字符串，DSH 插件同约定）。 */
const JSON_KEYS = ["customUrls", "customEventUrls", "customEntries"];

function asObject(v) {
	return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}
function asArray(v) {
	return Array.isArray(v) ? v : [];
}

function parseJson(raw, fallback) {
	try {
		const v = JSON.parse(raw || "");
		return v === null || v === undefined ? fallback : v;
	} catch {
		return fallback;
	}
}

/**
 * 保存若干键。
 *
 * **类型约定（重要）**：内存态 `cfg` 一律持有"自然类型"——
 *   `removed` / `order` / `hidden` 是数组，`customUrls` / `customEventUrls` 是对象，
 *   `customEntries` 是数组；只有**落盘时**才把三个 JSON 键序列化成字符串。
 *
 * 曾踩过的坑：早期版本让 cfg 直接持有落盘形态（有时是 JSON 字符串、有时是数组），
 * 结果 `[...cfg.removed]` 作用在字符串上会按**字符**展开，自定义地址也因为
 * `JSON.parse(对象)` 抛错而永久回落到默认值。统一类型后这两类问题一起消失。
 */
async function commit(patch) {
	const out = { ...patch };
	for (const k of JSON_KEYS) {
		if (k in out && typeof out[k] !== "string") out[k] = JSON.stringify(out[k]);
	}
	Object.assign(cfg, patch);
	await writeKeys(out);
	// 删除/恢复条目会改变引擎可见的条目集合，需重新向引擎取一次
	if ("removed" in patch || "customEntries" in patch) {
		allGames = await engine.listGames();
	}
	render();
}

/** 默认来源显示名（与 DSH 同口径）：source 标签 > 「默认来源」。 */
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

/** 自定义地址原文（剥掉 custom: 前缀）。 */
function customUrlText(urls, id) {
	const v = urls[id];
	return typeof v === "string" && v.startsWith("custom:") ? v.slice("custom:".length) : "";
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

	renderRemoved();
}

function renderRefreshOptions() {
	const current = Number(cfg.refreshMinutes) || 24 * 60;
	const inOptions = REFRESH_OPTIONS.some((o) => o.minutes === current);
	const opts = inOptions
		? REFRESH_OPTIONS.slice()
		: [{ label: `自定义（${current} 分钟）`, minutes: current }, ...REFRESH_OPTIONS];
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
	const urls = asObject(cfg.customUrls);
	const eventUrls = asObject(cfg.customEventUrls);
	const box = document.createElement("div");

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
	span.title = game.name;
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

	// 卡池来源 / 活动来源
	const gachaSel = renderSourceSelect(game, urls, false);
	const eventSel = renderSourceSelect(game, eventUrls, true);
	row.appendChild(gachaSel);
	row.appendChild(eventSel);

	// 操作：上移 / 下移 / 删除
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
	const del = document.createElement("button");
	del.type = "button";
	del.className = "btn mini danger";
	del.textContent = "删除";
	del.title = "从面板移除该条目";
	del.addEventListener("click", () => removeEntry(game));
	ops.append(up, down, del);
	row.appendChild(ops);
	box.appendChild(row);

	// 自定义地址输入行：仅在该侧选择「自定义…」时展开
	const customLine = document.createElement("div");
	customLine.className = "custom-line";
	let shown = false;
	if (urlMode(urls, game.id) === "custom") {
		customLine.appendChild(makeCustomUrlLabel(game, "customUrls", "卡池来源地址", customUrlText(urls, game.id)));
		shown = true;
	}
	if (urlMode(eventUrls, game.id) === "custom") {
		customLine.appendChild(
			makeCustomUrlLabel(game, "customEventUrls", "活动来源地址", customUrlText(eventUrls, game.id))
		);
		shown = true;
	}
	if (shown) box.appendChild(customLine);

	return box;
}

/** 内联的自定义地址输入（替代原先的 prompt 弹窗）。 */
function makeCustomUrlLabel(game, key, labelText, value) {
	const label = document.createElement("label");
	label.className = "custom-field";
	const cap = document.createElement("span");
	cap.textContent = labelText;
	label.appendChild(cap);

	const input = document.createElement("input");
	input.type = "text";
	input.value = value;
	input.placeholder = "https://…（须在扩展已声明的主机范围内）";
	input.setAttribute("list", "allowed-hosts");
	input.spellcheck = false;
	// 输入即写内存态，失焦或回车才落盘（避免每敲一个字都写一次 storage）
	input.addEventListener("change", () => {
		const next = { ...asObject(cfg[key]) };
		const v = input.value.trim();
		if (v === "") delete next[game.id];
		else next[game.id] = "custom:" + v;
		commit({ [key]: next });
	});
	input.addEventListener("keydown", (e) => {
		if (e.key === "Enter") input.blur();
	});
	label.appendChild(input);
	return label;
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

	sel.value = mode;
	if (![...sel.options].some((o) => o.value === sel.value)) sel.value = "default";

	sel.addEventListener("change", () => {
		const key = isEvent ? "customEventUrls" : "customUrls";
		const next = { ...asObject(cfg[key]) };
		if (sel.value === "default") {
			delete next[game.id];
		} else if (sel.value === "custom") {
			// 保留已填地址（若有）；首次切到自定义先置空，由用户在展开的输入框里填
			const cur = customUrlText(urls, game.id);
			next[game.id] = "custom:" + cur;
		} else {
			next[game.id] = sel.value;
		}
		commit({ [key]: next });
	});
	return sel;
}

/** 已删除的内置条目：可单独/一次性恢复。 */
function renderRemoved() {
	const removed = asArray(cfg.removed);
	const byId = new Map(allGames.map((g) => [g.id, g]));
	const names = builtinNameMap();
	// 已删除项不在 listGames() 里，名字从 core 暴露的内置来源表还原
	const rows = removed.map((id) => ({ id, name: byId.get(id)?.name || names.get(id) || id }));

	if (rows.length === 0) {
		el.removedCard.hidden = true;
		el.removedList.replaceChildren();
		return;
	}
	el.removedCard.hidden = false;

	const frag = document.createDocumentFragment();
	for (const r of rows) {
		const row = document.createElement("div");
		row.className = "removed-row";
		const name = document.createElement("span");
		name.textContent = r.name;
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "btn mini";
		btn.textContent = "恢复";
		btn.addEventListener("click", () => commit({ removed: removed.filter((x) => x !== r.id) }));
		row.append(name, btn);
		frag.appendChild(row);
	}
	const all = document.createElement("button");
	all.type = "button";
	all.className = "btn";
	all.textContent = "全部恢复";
	all.addEventListener("click", () => commit({ removed: [] }));
	const foot = document.createElement("div");
	foot.className = "row end";
	foot.appendChild(all);
	frag.appendChild(foot);

	el.removedList.replaceChildren(frag);
}

// —— 操作 ——

/** 删除条目：内置条目记入 removed；自定义条目从 customEntries 移除（不可恢复）。 */
async function removeEntry(game) {
	if (game.custom) {
		const customs = asArray(cfg.customEntries);
		const next = Array.isArray(customs) ? customs.filter((c) => c && c.id !== game.id) : [];
		await commit({ customEntries: next });
		return;
	}
	const removed = asArray(cfg.removed);
	if (removed.includes(game.id)) return;
	// 同时清掉该条目的排序与来源覆盖，避免残留配置
	const order = asArray(cfg.order).filter((x) => x !== game.id);
	const urls = { ...asObject(cfg.customUrls) };
	const eventUrls = { ...asObject(cfg.customEventUrls) };
	delete urls[game.id];
	delete eventUrls[game.id];
	await commit({
		removed: [...removed, game.id],
		order: order.length ? order : null,
		customUrls: urls,
		customEventUrls: eventUrls
	});
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
	try {
		const mod = await import("./core-version.js");
		el.coreVer.textContent = mod.CORE_VERSION;
	} catch {
		el.coreVer.textContent = "—";
	}

	// 主机白名单：供自定义地址输入框提示可选范围（与 manifest 同源）
	allowedHosts = (manifest.host_permissions || [])
		.map((h) => h.replace(/^https:\/\//, "").replace(/\/\*$/, ""))
		.filter((h) => !/moegirl|yostar|googleusercontent/.test(h));
	el.allowedHosts.replaceChildren(
		...allowedHosts.map((h) => {
			const op = document.createElement("option");
			op.value = `https://${h}/`;
			return op;
		})
	);

	const [games, stored] = await Promise.all([
		engine.listGames(),
		readKeys([
			"order",
			"hidden",
			"removed",
			"customEntries",
			"customUrls",
			"customEventUrls",
			"autoRefresh",
			"refreshMinutes"
		])
	]);
	allGames = games;
	cfg = {
		order: asArray(stored.order),
		hidden: asArray(stored.hidden),
		// 自然类型（见 commit 的类型约定）：落盘的 JSON 字符串在这里解析回对象/数组
		removed: Array.isArray(stored.removed) ? stored.removed : parseJson(stored.removed, []),
		customEntries: Array.isArray(stored.customEntries) ? stored.customEntries : parseJson(stored.customEntries, []),
		customUrls: asObject(typeof stored.customUrls === "string" ? parseJson(stored.customUrls, {}) : stored.customUrls),
		customEventUrls: asObject(
			typeof stored.customEventUrls === "string" ? parseJson(stored.customEventUrls, {}) : stored.customEventUrls
		),
		autoRefresh: stored.autoRefresh !== false,
		refreshMinutes: Number(stored.refreshMinutes) || 24 * 60
	};
	render();
})().catch((err) => {
	el.count.textContent = "载入失败：" + String((err && err.message) || err);
});
