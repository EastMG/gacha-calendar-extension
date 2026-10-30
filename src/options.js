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
import { gameColor, isHexColor } from "./game-color.js";
import { sourceTable } from "./entry-meta.js";
import { buildIcs, icsFileName, fnv1a } from "./ics.js";
import { parseDisplayRange } from "./view-helpers.js";
import { REMIND_DEFAULT_END_NODES, remindNodesOf, remindNodesToggleOf } from "./remind.js";
import { transport } from "./transport.js";
import { createVisibility, toggleVisibility } from "./visibility.js";
// 默认来源显示名与 core 的 getDefaultSourceName 同口径（含「未配置」文案）
import { defaultSourceName } from "./entry-meta.js";

const engine = createEngine({ transport, storage: createStorage() });

/** 刷新频率选项（分钟）——与 DSH 插件一致的按天档位。 */
/** 刷新时机下拉的第一项：浏览器启动后首次打开时抓一轮（默认）。 */
const REFRESH_STARTUP = { label: "浏览器启动时", value: "startup" };

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
	newPanel: document.getElementById("newPanel"),
	panelTop: document.getElementById("panelTop"),
	badge: document.getElementById("badge"),
	remindOn: document.getElementById("remindOn"),
	remindChips: document.getElementById("remindChips"),
	testNotify: document.getElementById("testNotify"),
	testNotifyHint: document.getElementById("testNotifyHint"),
	exportIcs: document.getElementById("exportIcs"),
	refreshMinutes: document.getElementById("refreshMinutes"),
	resetOrder: document.getElementById("resetOrder"),
	removedCard: document.getElementById("removed-card"),
	removedList: document.getElementById("removed-list"),
	selfCheck: document.getElementById("selfCheck"),
	scSummary: document.getElementById("sc-summary"),
	scList: document.getElementById("sc-list"),
	ver: document.getElementById("ver"),
	coreVer: document.getElementById("core-ver"),
	buildId: document.getElementById("build-id"),
	bgInfo: document.getElementById("bg-info")
};

/** 当前设置快照（内存态；每次改动后落盘并重渲染）。
 *  类型约定见 commit()：这里一律是自然类型（数组/对象），不是 JSON 字符串。 */
let cfg = {
	order: [],
	hidden: [],
	shown: [],
	removed: [],
	customEntries: [],
	customUrls: {},
	customEventUrls: {},
	autoRefresh: true,
	// 刷新时机："startup" = 浏览器启动后首次打开抓一轮（默认）；"interval" = 按 refreshMinutes 间隔
	refreshMode: "startup",
	refreshMinutes: 24 * 60,
	// 实验特性：新日程面板（默认关，与 DSH 插件同键名同语义）
	// 默认开启（用户 2026-10-21 指定）
	newPanel: true,
	// 新面板顶部区域二选一："recent" 近期列表 / "slot" 近期卡片
	// 默认「近期卡片」（= slot）
	panelTop: "slot",
	// 到期角标（工具栏图标上显示 3 天内到期数）；默认开
	badge: true,
	// 到期提醒：默认**开**（与 DSH 的 remindOn 默认一致）；用户可在设置页关闭
	remindOn: true,
	// 提醒档位（到期前多少小时）：字符串，与 DSH 的 remindEndNodes 同格式
	remindEndNodes: "72,24,6,2"
};
/** 生效中的条目（core 已按 removed 过滤）元信息。 */
let allGames = [];
// 出厂色在 core 的运行时来源表里（listGames 不返回 color）——与面板同一个来源
let colorTable = new Map();
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
const JSON_KEYS = ["customUrls", "customEventUrls", "customEntries", "gameColors"];

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
 *   `removed` / `order` / `hidden` / `shown` 是数组，`customUrls` / `customEventUrls` 是对象，
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

/**
 * 「顶部区域」只在「新日程面板」开启时可选。
 * 未开启时它对新面板没有任何作用，仍可点会让人误以为改了就生效（用户 2026-10-21 要求禁用）。
 */
function syncPanelTopEnabled() {
	const on = !!(el.newPanel && el.newPanel.checked);
	if (el.panelTop) {
		el.panelTop.disabled = !on;
		el.panelTop.setAttribute("aria-disabled", on ? "false" : "true");
	}
	const row = document.getElementById("panelTopRow");
	// 自测脚本用的是极简假 DOM（没有 classList）⇒ 这里做能力判断，缺了就跳过视觉变淡
	if (row && row.classList && typeof row.classList.toggle === "function") row.classList.toggle("is-off", !on);
}

function render() {
	colorTable = sourceTable(engine);
	const order = orderedGames();
	// 副标题已去掉（用户 2026-10-30 要求），count 元素可能不存在 —— 保持可选
	if (el.count) el.count.textContent = String(allGames.length);
	el.autoRefresh.checked = cfg.autoRefresh !== false;
	if (el.newPanel) el.newPanel.checked = cfg.newPanel !== false;
	if (el.panelTop) el.panelTop.value = cfg.panelTop === "recent" ? "recent" : "slot";
	if (el.badge) el.badge.checked = cfg.badge !== false;
	if (el.remindOn) el.remindOn.checked = cfg.remindOn !== false;
	renderRemindChips();
	syncPanelTopEnabled();
	renderRefreshOptions();

	const frag = document.createDocumentFragment();
	order.forEach((game, i) => frag.appendChild(renderEntry(game, i, order)));
	el.entries.replaceChildren(frag);

	renderRemoved();
}

function renderRefreshOptions() {
	const current = Number(cfg.refreshMinutes) || 24 * 60;
	const items = [REFRESH_STARTUP, ...REFRESH_OPTIONS.map((o) => ({ label: o.label, value: String(o.minutes) }))];
	el.refreshMinutes.replaceChildren(
		...items.map((it) => {
			const op = document.createElement("option");
			op.value = it.value;
			op.textContent = it.label;
			return op;
		})
	);
	el.refreshMinutes.value = cfg.refreshMode === "interval" ? String(current) : REFRESH_STARTUP.value;
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

	// 展示开关：勾选态 = 当前是否**可见**（不是"hidden 数组里有没有"）
	const showCell = document.createElement("div");
	showCell.className = "cell-center";
	const cb = document.createElement("input");
	cb.type = "checkbox";
	const vis = createVisibility(engine, cfg);
	cb.checked = vis.isChecked(game.id);
	cb.title = "是否在面板中显示";
	cb.addEventListener("change", () => {
		// 默认隐藏的条目要写 shown 才能显示（见 src/visibility.js 的三态说明）
		commit(toggleVisibility(engine, cfg, game.id, cb.checked));
	});
	showCell.appendChild(cb);
	row.appendChild(showCell);

	// 强调色：原生取色器（点色块选色）＋「↺」恢复默认
	// 存储形如 { 游戏id: "#rrggbb" }；没有该键 = 用 core 算出的出厂色。
	const colors = asObject(cfg.gameColors);
	const curColor = typeof colors[game.id] === "string" ? colors[game.id] : "";
	// **显示面板里实际在用的颜色**（覆盖 or 名字哈希色盘），而不是一个灰块占位 ——
	// 两端共用 src/game-color.js 的 gameColor()，口径必然一致。
	// 出厂色来自 core 的 SOURCES（与面板 mergeGames 的 src.color 同源）；无则回落到名字哈希
	const factory = colorTable.get(game.id) || {};
	const effective = gameColor({ id: game.id, name: game.name, color: factory.color }, colors);
	const colorCell = document.createElement("div");
	colorCell.className = "cell-center color-cell";
	const swatch = document.createElement("input");
	swatch.type = "color";
	swatch.className = "color-swatch";
	swatch.value = isHexColor(effective) ? effective : "#888888";
	// 悬停只给色值本身（之前是"出厂色 #xxxxxx（点击修改）"，太啰嗦）
	swatch.title = effective.toUpperCase();
	// 无障碍标签保留语义（不可见）
	swatch.setAttribute("aria-label", (curColor ? "自定义颜色 " : "出厂色 ") + effective.toUpperCase());
	swatch.addEventListener("change", () => {
		const map = asObject(cfg.gameColors);
		map[game.id] = swatch.value;
		commit({ gameColors: map });
	});
	colorCell.appendChild(swatch);
	if (curColor) {
		const reset = document.createElement("button");
		reset.type = "button";
		reset.className = "btn mini color-reset";
		reset.textContent = "↺";
		reset.title = "恢复默认颜色";
		reset.addEventListener("click", () => {
			const map = asObject(cfg.gameColors);
			delete map[game.id];
			commit({ gameColors: map });
		});
		colorCell.appendChild(reset);
	}
	row.appendChild(colorCell);

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
	input.placeholder = "https://…（须在权限清单内）";
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
	add("default", defaultSourceName(engine, game, isEvent));
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
	el.selfCheck.textContent = "检查中…";
	el.scSummary.textContent = "";
	el.scList.replaceChildren();
	const started = Date.now();
	try {
		const report = await engine.selfCheck();
		const secs = ((Date.now() - started) / 1000).toFixed(1);
		const s = report.summary || {};
		el.scSummary.textContent = `共 ${report.total} 个条目 · 正常 ${s.ok || 0} / 未公布 ${s.nomatch || 0} / 报错 ${s.down || 0} · 用时 ${secs}s`;
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
		el.scSummary.textContent = "检查失败：" + String((err && err.message) || err);
	} finally {
		el.selfCheck.disabled = false;
		el.selfCheck.textContent = "重新检查";
	}
}

/** 渲染提醒档位胶囊（选中态 = 当前 remindEndNodes；全不选表示"不提醒"）。 */
function renderRemindChips() {
	if (!el.remindChips) return;
	const selected = new Set(remindNodesOf(cfg.remindEndNodes, REMIND_DEFAULT_END_NODES));
	el.remindChips.replaceChildren(
		...REMIND_DEFAULT_END_NODES.map((n) => {
			const b = document.createElement("button");
			b.type = "button";
			b.className = "chip";
			b.dataset.node = String(n);
			b.textContent = n + " 小时";
			b.setAttribute("aria-pressed", selected.has(n) ? "true" : "false");
			b.addEventListener("click", () => {
				cfg.remindEndNodes = remindNodesToggleOf(cfg.remindEndNodes, n, REMIND_DEFAULT_END_NODES);
				commit({ remindEndNodes: cfg.remindEndNodes });
			});
			return b;
		})
	);
}

/** 发送测试通知：与真实提醒完全隔离（不读写去重状态），只验证通知链路。 */
async function sendTestNotify() {
	if (!el.testNotify) return;
	el.testNotify.disabled = true;
	if (el.testNotifyHint) el.testNotifyHint.textContent = "发送中…";
	try {
		const res = await chrome.runtime.sendMessage({ type: "testNotify" });
		if (res && res.ok) {
			if (el.testNotifyHint) el.testNotifyHint.textContent = "已发送：" + res.title;
		} else {
			const errText = (res && res.error) || "未知原因";
			const senderText = res && res.hint ? "（" + res.hint + "）" : "";
			if (el.testNotifyHint) el.testNotifyHint.textContent = "发送失败：" + errText + senderText;
		}
	} catch (err) {
		if (el.testNotifyHint) el.testNotifyHint.textContent = "发送失败：" + String((err && err.message) || err);
	} finally {
		el.testNotify.disabled = false;
	}
}

/**
 * 导出「当前在期 / 尚未结束」的卡池与活动为 .ics 快照。
 *
 * 数据来源与面板完全一致：engine.getCached() + parseDisplayRange（本机时区外显文本）。
 * 已结束的条目不导出；没日期的（例如刚抓取失败/未公布）跳过。
 * 下载走 Blob + <a download>，因此**不需要 downloads 权限**。
 */
async function exportCalendar() {
	const now = new Date();
	const nowTs = now.getTime();
	const cached = await engine.getCached();
	const vis = createVisibility(engine, cfg);
	const table = sourceTable(engine);
	const events = [];
	for (const g of orderedGames()) {
		if (vis.isHidden(g.id)) continue;
		const rec = cached.games[g.id];
		if (!rec) continue;
		const sides = [
			["gacha", "卡池", rec.banner, rec.bannerDates, rec.roles],
			["event", "活动", rec.event, rec.eventDates, ""]
		];
		for (const [side, label, title, dates, roles] of sides) {
			const name = String(title || "").trim();
			if (!name) continue;
			const range = parseDisplayRange(dates, now);
			if (!range || !(range.endTs > nowTs)) continue; // 已结束的不导出
			const meta = table.get(g.id) || {};
			const desc = [
				"档期：" + String(dates || "").trim(),
				roles ? "UP：" + String(roles).trim() : "",
				typeof meta.url === "string" ? meta.url : ""
			]
				.filter(Boolean)
				.join("\n");
			events.push({
				uid: fnv1a(g.id + "|" + side + "|" + range.startTs) + "@gacha-calendar-extension",
				startTs: range.startTs,
				endTs: range.endTs,
				summary: g.name + " · " + label + "：" + name,
				description: desc
			});
		}
	}
	const label = "导出 .ics";
	if (!events.length) {
		el.exportIcs.textContent = "当前没有在期条目";
		setTimeout(() => { el.exportIcs.textContent = label; }, 2500);
		return;
	}
	const ics = buildIcs(events, nowTs);
	const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = icsFileName(nowTs);
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 5000);
	el.exportIcs.textContent = "已导出 " + events.length + " 条";
	setTimeout(() => { el.exportIcs.textContent = label; }, 2500);
}

// —— 入口 ——

el.autoRefresh.addEventListener("change", () => commit({ autoRefresh: el.autoRefresh.checked }));
// 实验特性：切换后由 background 同步工具栏行为（开启=直接打开日程页面，关闭=弹 popup）
if (el.newPanel) el.newPanel.addEventListener("change", () => { commit({ newPanel: el.newPanel.checked }); syncPanelTopEnabled(); });
if (el.panelTop) el.panelTop.addEventListener("change", () => commit({ panelTop: el.panelTop.value === "slot" ? "slot" : "recent" }));
if (el.badge) el.badge.addEventListener("change", () => commit({ badge: el.badge.checked }));
if (el.remindOn) el.remindOn.addEventListener("change", () => commit({ remindOn: el.remindOn.checked }));
if (el.testNotify) el.testNotify.addEventListener("click", () => sendTestNotify());
if (el.exportIcs) el.exportIcs.addEventListener("click", () => exportCalendar());
el.refreshMinutes.addEventListener("change", () => {
		const v = el.refreshMinutes.value;
		if (v === REFRESH_STARTUP.value) commit({ refreshMode: "startup" });
		else commit({ refreshMode: "interval", refreshMinutes: Number(v) || 24 * 60 });
	});
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
	try {
		const bi = await import("./build-info.js");
		if (el.buildId) el.buildId.textContent = bi.BUILD_ID;
	} catch {
		if (el.buildId) el.buildId.textContent = "—";
	}
	// 后台 SW 的构建标记：与页面构建不一致 ⇒ 浏览器跑的是旧 service worker（需要重载扩展）
	try {
		const diag = await chrome.runtime.sendMessage({ type: "diag" });
		if (el.bgInfo) el.bgInfo.textContent = (diag && diag.buildId) || "—";
	} catch {
		if (el.bgInfo) el.bgInfo.textContent = "无响应";
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
			"shown",
			"removed",
			"customEntries",
			"customUrls",
			"customEventUrls",
			"autoRefresh",
			"refreshMinutes",
			"refreshMode",
			"newPanel",
			"panelTop",
			"gameColors",
			"badge",
			"remindOn",
			"remindEndNodes",
			"notifyName"
		])
	]);
	allGames = games;
	cfg = {
		order: asArray(stored.order),
		hidden: asArray(stored.hidden),
		shown: asArray(stored.shown),
		// 自然类型（见 commit 的类型约定）：落盘的 JSON 字符串在这里解析回对象/数组
		removed: Array.isArray(stored.removed) ? stored.removed : parseJson(stored.removed, []),
		customEntries: Array.isArray(stored.customEntries) ? stored.customEntries : parseJson(stored.customEntries, []),
		customUrls: asObject(typeof stored.customUrls === "string" ? parseJson(stored.customUrls, {}) : stored.customUrls),
		customEventUrls: asObject(
			typeof stored.customEventUrls === "string" ? parseJson(stored.customEventUrls, {}) : stored.customEventUrls
		),
		autoRefresh: stored.autoRefresh !== false,
		refreshMinutes: Number(stored.refreshMinutes) || 24 * 60,
		// 默认「浏览器启动时」（老配置没有这个键 ⇒ 也按启动时）
		refreshMode: stored.refreshMode === "interval" ? "interval" : "startup",
		newPanel: stored.newPanel !== false,
		panelTop: stored.panelTop === "recent" ? "recent" : "slot",
		// 落盘是 JSON 字符串；这里解析回对象（{ 游戏id: "#rrggbb" }）
		gameColors: parseJson(stored.gameColors, {}),
		badge: stored.badge !== false,
		// 默认开；兼容 0.2.33 之前的旧键 notify（那版默认关）
		remindOn: typeof stored.remindOn === "boolean" ? stored.remindOn : stored.notify === false ? false : true,
		remindEndNodes: typeof stored.remindEndNodes === "string" ? stored.remindEndNodes : "72,24,6,2"
	};
	render();
})().catch((err) => {
	if (el.count) el.count.textContent = "载入失败：" + String((err && err.message) || err);
	else console.error("设置页载入失败：", err);
});
