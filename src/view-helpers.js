// 展示层辅助函数（**UI 专属，不属于 core**）。
//
// 设计原则（与 core 的分工）：**JSON 负责"有什么内容"，UI 负责"怎么展示"**。
// 所以倒计时、角色名精简、悬停文案这类"只影响怎么显示"的逻辑留在各平台 UI 里实现，
// 不塞回 core —— 否则每个平台都被 DSH/浏览器的展示口径绑死。
//
// 本文件里的函数全部是从 DSH 插件的 src/client/60-helpers.js 逐条移植的**纯函数**（无副作用），
// 口径与 DSH 面板完全一致，便于两边对照排查。
//
// ⚠️ 注意：`buildScrapeInfo` / `sideFailText` / `entryFailParts` 这些函数在 core 里
// **没有公开导出**（只挂在 `__test` 上，那是给回归脚本用的）。所以这里按同一口径本地实现，
// 只依赖 core 冻结的 Result JSON 字段（gachaFail / eventFail / skipped），不碰 core 内部状态。

// —— 抓取状态判定与文案 ——
// core 把每一侧归一成三态：null=正常 / {kind:"nomatch"}=源站没有当期内容 / {kind:"down",reason}=报错。
const SIDE_TEXT = {
	gacha: { fail: "卡池失败", nomatch: "新卡池未公布" },
	event: { fail: "活动失败", nomatch: "新活动未公布" }
};

/** 兼容旧缓存：老版本把失败存成字符串，读到时升级成 { kind, reason }。 */
export function normalizeFail(f) {
	if (!f) return null;
	if (typeof f === "string") {
		return /nomatch|no-match/i.test(f) ? { kind: "nomatch" } : { kind: "down", reason: "抓取异常" };
	}
	return f.kind === "down" || f.kind === "nomatch" ? f : null;
}

/** 一侧状态的单行文案：down → "卡池失败：网络不通"；nomatch → "新卡池未公布"；正常 → ""。 */
export function sideFailText(side, fail) {
	const f = normalizeFail(fail);
	if (!f) return "";
	return f.kind === "down"
		? SIDE_TEXT[side].fail + "：" + (f.reason || "抓取异常")
		: SIDE_TEXT[side].nomatch;
}

/** 逐条归类：固定顺序（卡池在前、活动在后；每侧至多一条）。 */
export function entryFailParts(rec) {
	const parts = [];
	const gf = normalizeFail(rec && rec.gachaFail);
	const ef = normalizeFail(rec && rec.eventFail);
	if (gf) parts.push({ side: "gacha", kind: gf.kind, text: sideFailText("gacha", gf) });
	if (ef) parts.push({ side: "event", kind: ef.kind, text: sideFailText("event", ef) });
	return parts;
}

/**
 * 顶部"成功 N/M + 分类"提示（只读 Result JSON，与 DSH 面板同口径）。
 * games 为按显示顺序排列的条目元信息（含 id / name）。
 */
export function buildScrapeInfo(games, result) {
	const list = Array.isArray(games) ? games : [];
	const rec = (result && result.games) || {};
	// "成功"口径 = 两侧都没有**报错**（down）；只有 nomatch（未命中）仍算成功
	const okCount = list.filter((g) => {
		const r = rec[g.id];
		if (!r || r.skipped) return false;
		return normalizeFail(r.gachaFail)?.kind !== "down" && normalizeFail(r.eventFail)?.kind !== "down";
	}).length;
	const skippedCount = list.filter((g) => rec[g.id] && rec[g.id].skipped).length;
	const skippedNote = skippedCount > 0 ? `（跳过 ${skippedCount} 个）` : "";
	const CATS = [
		["gachaFail", "down", SIDE_TEXT.gacha.fail],
		["eventFail", "down", SIDE_TEXT.event.fail],
		["gachaFail", "nomatch", SIDE_TEXT.gacha.nomatch],
		["eventFail", "nomatch", SIDE_TEXT.event.nomatch]
	];
	const groups = CATS.map(([field, kind, label]) => ({
		label,
		names: list
			.filter((g) => {
				const f = normalizeFail(rec[g.id] && rec[g.id][field]);
				return f && f.kind === kind;
			})
			.map((g) => g.name)
	})).filter((grp) => grp.names.length > 0);
	let info = `成功 ${okCount}/${list.length}${skippedNote}`;
	groups.forEach((grp) => {
		info += ` ${grp.label}：${grp.names.join("、")}`;
	});
	const lines = list
		.map((g) => {
			const parts = entryFailParts(rec[g.id] || {});
			return parts.length > 0 ? `${g.name} ${parts.map((p) => p.text).join("、")}` : "";
		})
		.filter(Boolean);
	return { info, lines };
}

/**
 * 把"本次没拿到新内容"的说明补进悬停文案：
 * 用括号包住；若该列显示的是沿回的旧值（stale），则另起一行补在旧内容下面。
 */
export function withFailNote(base, side, fail, stale) {
	const text = sideFailText(side, fail);
	const note = text ? "（" + text + "）" : "";
	if (!note) return base || "";
	return stale && base ? base + "\n" + note : note;
}

// —— 角色名精简（面板外显用）——
// 蔚蓝档案三服的角色名括号后缀是**换装版本标识**（桔梗（泳装）），去掉会与基础版撞名，
// 所以保留括号但统一成半角；其它游戏删掉（属性/职业）后缀。
const BA_ROLE_IDS = ["ba-cn", "ba-global", "ba-jp"];

function baRoleName(name) {
	return String(name || "").replace(/（/g, "(").replace(/）/g, ")");
}

/**
 * 角色名精简：去「」装饰、去（属性/职业）后缀；
 * 「称号·名字」按分隔符去称号（· U+00B7 不限字数；• U+2022 仅 4 字前缀）。
 * 悬停全文仍用原始 roles。
 */
export function cleanRoleNames(roles, gameId) {
	const isBa = BA_ROLE_IDS.includes(gameId);
	return String(roles || "")
		.split(/[、,，]/)
		.map((n) => {
			let s = n.replace(/[「」【】]/g, "");
			if (isBa) s = baRoleName(s);
			else s = s.replace(/[（(][^）)]*[）)]/g, "");
			s = s.trim();
			const mDot = s.match(/^([\u4e00-\u9fff]{2,10})[\u00B7](.+)$/);
			if (mDot && mDot[2].trim()) {
				s = mDot[2].trim();
			} else {
				const mBullet = s.match(/^([\u4e00-\u9fff]{4})[\u2022](.+)$/);
				if (mBullet) s = mBullet[2].trim();
			}
			return s;
		})
		.filter(Boolean)
		.join("、");
}

// —— 时间倒计时 ——

/**
 * 解析展示用时间段（"08-12 06:00 ~ 09-01 17:59"，无年份）
 * → { startTs, endTs }；无法解析返回 null。跨年（结束月份 < 开始月份）自动 +1 年。
 */
export function parseDisplayRange(str, now) {
	if (typeof str !== "string") return null;
	const parts = str.split(/~/).map((x) => x.trim());
	if (parts.length < 2) return null;
	const parsePart = (p) => {
		const m = p.match(/^(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/);
		if (!m) return null;
		const mo = Number(m[1]), d = Number(m[2]);
		if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
		const h = m[3] ? Number(m[3]) : 0;
		const mi = m[4] ? Number(m[4]) : 0;
		return { mo, d, base: new Date(now.getFullYear(), mo - 1, d, h, mi).getTime() };
	};
	const a = parsePart(parts[0]);
	const b = parsePart(parts[1]);
	if (!a || !b) return null;
	const startTs = a.base;
	let endTs = b.base;
	if (b.mo < a.mo) endTs += 365 * 24 * 60 * 60 * 1000;
	return { startTs, endTs };
}

/** 剩余时间文本："X 天 X 小时 X 分钟"；已过（负数）返回 null 由调用方处理。 */
export function formatRemaining(ts, now) {
	const diff = ts - now.getTime();
	if (diff < 0) return null;
	const days = Math.floor(diff / 86400000);
	const hours = Math.floor((diff % 86400000) / 3600000);
	const mins = Math.floor((diff % 3600000) / 60000);
	return `${days}天${hours}小时${mins}分钟`;
}

/**
 * 时间列展示：未开始 → "还有 X 天 X 小时 X 分钟开始"；
 * 进行中 → "还剩 X 天 X 小时 X 分钟"；已结束 → "已结束"。解析不了就原样返回。
 */
export function displayTimeCell(raw, now) {
	const r = parseDisplayRange(raw, now);
	if (!r) return raw || "";
	if (now.getTime() < r.startTs) {
		const t = formatRemaining(r.startTs, now);
		return t === null ? raw : `还有 ${t} 开始`;
	}
	if (now.getTime() > r.endTs) return "已结束";
	const t = formatRemaining(r.endTs, now);
	return t === null ? raw : `还剩 ${t}`;
}

/** 游戏名/图标悬停：这行数据的刷新时间；没有成功记录则只显示名称。 */
export function buildRowTitle(name, okAt) {
	return okAt ? name + "\n刷新时间 " + new Date(okAt).toLocaleString() : name;
}

/** 卡池/活动两列的外显与悬停文案（与 DSH 面板同口径）。 */
export function buildCells(rec, gameId) {
	const gachaVisible = rec.roles ? cleanRoleNames(rec.roles, gameId) : rec.banner || "—";
	const gachaTitle = (rec.roles ? `${rec.banner}：${rec.roles}` : rec.banner || "") +
		(rec.bannerDates ? `\n${rec.bannerDatesRaw || rec.bannerDates}` : "");
	const eventName = rec.event || "—";
	const eventTitle = rec.event
		? (rec.eventDates ? `${rec.event}\n${rec.eventDatesRaw || rec.eventDates}` : rec.event)
		: (rec.eventDatesRaw || rec.eventDates || "");
	return {
		gachaVisible,
		gachaTitle: withFailNote(rec.bannerHover || gachaTitle, "gacha", rec.gachaFail, rec.gachaStale),
		datesTitle: withFailNote(rec.bannerDatesRaw || rec.bannerDates, "gacha", rec.gachaFail, rec.gachaStale),
		eventName,
		eventTitle: withFailNote(rec.eventHover || eventTitle, "event", rec.eventFail, rec.eventStale),
		eventDatesTitle: withFailNote(rec.eventDatesRaw || rec.eventDates, "event", rec.eventFail, rec.eventStale)
	};
}

/** 缓存缺失时，用条目自带的静态默认值兜底（自定义条目可以手填内容）。 */
export function defaultRecord(game) {
	return {
		...game.defaults,
		bannerDatesRaw: "",
		bannerHover: "",
		eventDatesRaw: "",
		eventHover: "",
		gachaFail: null,
		eventFail: null,
		gachaStale: false,
		eventStale: false,
		okAt: 0
	};
}

/**
 * **纯函数**：把一个条目 + 它的抓取记录 → 该行要显示的全部内容。
 *
 * 之所以抽成纯函数：面板（DOM）与自动化验证（Node 或扩展内）能跑**完全同一份**展示逻辑，
 * 这样"渲染对不对"就不必靠肉眼看截图来确认，也能在 Node 里做逐字段比对。
 */
export function buildRowModel(game, rec, now) {
	const cells = buildCells(rec, game.id);
	const parts = entryFailParts(rec);
	const down = parts.find((p) => p.kind === "down");
	const badge = parts.length === 0 ? null : down ? { text: down.text, cls: "err" } : { text: parts[0].text, cls: "warn" };
	const stale = !!(rec.gachaStale || rec.eventStale);
	return {
		id: game.id,
		name: game.name,
		icon: game.icon,
		title: buildRowTitle(game.name, rec.okAt),
		badge,
		staleBadge: !badge && stale ? { text: "沿用旧数据", cls: "" } : null,
		gacha: { value: cells.gachaVisible, title: cells.gachaTitle },
		gachaDates: { value: displayTimeCell(rec.bannerDates || "", now), title: cells.datesTitle },
		event: { value: cells.eventName, title: cells.eventTitle },
		eventDates: { value: displayTimeCell(rec.eventDates || "", now), title: cells.eventDatesTitle }
	};
}
