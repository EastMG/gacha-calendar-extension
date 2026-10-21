// 新日程面板（实验特性）—— **一比一**移植自 DSH 插件 dsh-gacha-calendar。
//
// 来源：该仓库 src/client/80-components.js
//   · 第 66-98 行   gameIconGlyph / GameIcon
//   · 第 192-1082 行 日程常量、纯函数（schedule*）、留白卡 SlotCard、以及 ScheduleView 本体
//
// 移植方式：**不改写组件的渲染逻辑**。原文件是 JSX 的转译产物（直接调用 react/jsx-runtime），
// 因此这里保留其原始代码，只补齐它原本由 DSH 宿主提供的两个模块绑定
// （react / react/jsx-runtime），并把原本来自 60-helpers.js 的纯函数改为从本仓库的
// view-helpers.js 引入（那边是逐函数移植的同一份实现）。
//
// ⚠️ 改动本文件前请优先改上游（插件）对应区段再重新移植，否则两边会漂移。
//
// ⚠️ 本文件已含**扩展侧改版**（不属于上游）：ScheduleView 多两个可选 prop ——
//    · topMode: "recent" | "slot"  顶部区域在「近期列表」与「留白卡」之间二选一
//    · stacked: true               游戏表改为每款游戏两行（卡池 / 活动）以节省宽度
//    两者都不传时行为与上游一致。改动点均以「扩展侧改版」注释标出。

import * as react from "react";
import * as react_jsx_runtime from "react/jsx-runtime";
import { normalizeFail, cleanRoleNames, parseDisplayRange, sideFailText, buildRowTitle } from "../view-helpers.js";
import { gameColor } from "../game-color.js";

// —— 上游 60-helpers.js 里缺的两个小工具（view-helpers 未包含）——
const isDown = (f) => !!f && f.kind === "down";
function parseJsonStr(str, fallback) {
	try { return JSON.parse(str || "") ?? fallback; } catch { return fallback; }
}

// —— 上游 15-env.js 的时区换算（源站墙钟 tz → 绝对时刻）——
// 日程面板的档期解析依赖它：来源声明了 tz（IANA 名或固定偏移分钟）时按该时区换算，
// 未声明则沿用本机时区。
const TZ_FMT_CACHE = new Map();
function tzFormatter(tzName) {
	let f = TZ_FMT_CACHE.get(tzName);
	if (f === void 0) {
		try {
			f = new Intl.DateTimeFormat("en-US", {
				timeZone: tzName, hour12: false,
				year: "numeric", month: "2-digit", day: "2-digit",
				hour: "2-digit", minute: "2-digit", second: "2-digit"
			});
		} catch { f = null; } // 环境不支持该时区名（ICU 缺失）→ 退化为本机时区
		TZ_FMT_CACHE.set(tzName, f);
	}
	return f;
}
// 某时刻在某时区的偏移（分钟，东为正）。IANA 名不可用时返回 null。
function tzOffsetMinutesAt(tzName, ts) {
	const f = tzFormatter(tzName);
	if (!f) return null;
	const d = new Date(ts);
	if (isNaN(d.getTime())) return null;
	const parts = f.formatToParts(d);
	const g = (k) => { const p = parts.find((x) => x.type === k); return p ? Number(p.value) : NaN; };
	const h = g("hour") % 24; // hour12:false 在个别环境对午夜给 24 → 归零
	const asUTC = Date.UTC(g("year"), g("month") - 1, g("day"), h, g("minute"), g("second"));
	return (asUTC - (Math.floor(ts / 1000) * 1000)) / 60000;
}
// 源站时区表示 → 该时刻的偏移（分钟）：固定数字直接用；IANA 名按 ts 求（含 DST）；无法判定 → null
function sourceOffsetMinutes(tz, ts) {
	if (tz == null || tz === "") return null;
	if (typeof tz === "number") return Number.isFinite(tz) ? tz : null;
	if (typeof tz === "string") {
		if (/^[+-]?\d+$/.test(tz.trim())) return Number(tz.trim());
		return tzOffsetMinutesAt(tz.trim(), ts);
	}
	return null;
}
// 绝对毫秒 → 在**源站时区**下的墙上时钟字段（tz 为空/不可用时退化为本机时区）
function sourceWallParts(ts, tz) {
	const d = new Date(ts);
	if (tz == null || tz === "") {
		return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes() };
	}
	if (typeof tz === "string" && !/^[+-]?\d+$/.test(tz.trim())) {
		const f = tzFormatter(tz.trim());
		if (f) {
			const parts = f.formatToParts(d);
			const g = (k) => { const p = parts.find((x) => x.type === k); return p ? Number(p.value) : NaN; };
			return { y: g("year"), mo: g("month"), d: g("day"), h: g("hour") % 24, mi: g("minute") };
		}
		return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes() };
	}
	// 固定偏移（数字或 "+8" 形式）→ 平移后再取 UTC 字段
	const off = sourceOffsetMinutes(tz, ts);
	if (off == null) {
		return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes() };
	}
	const s = new Date(ts + off * 60000);
	return { y: s.getUTCFullYear(), mo: s.getUTCMonth() + 1, d: s.getUTCDate(), h: s.getUTCHours(), mi: s.getUTCMinutes() };
}

// —— 上游 25-parser-shared.js 的窗口文本格式化 ——
// 时间戳 → 显示文本。tz（可选）= **按该时区渲染**（源站墙钟），这样文本与绝对时刻一致。
function wallOf(ts, tz) {
	if (typeof sourceWallParts === "function") return sourceWallParts(ts, tz);
	const d = new Date(ts);
	return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes() };
}
function fmtMdHm(ts, tz) {
	const w = wallOf(ts, tz);
	return `${String(w.mo).padStart(2, "0")}-${String(w.d).padStart(2, "0")} ${String(w.h).padStart(2, "0")}:${String(w.mi).padStart(2, "0")}`;
}
function fmtYmdHm(ts, tz) {
	const w = wallOf(ts, tz);
	return `${w.y}-${String(w.mo).padStart(2, "0")}-${String(w.d).padStart(2, "0")} ${String(w.h).padStart(2, "0")}:${String(w.mi).padStart(2, "0")}`;
}
// 窗口起止文本：两端同一年 → MM-DD；跨年 → 两端都带年份
function fmtWindow(startTs, endTs, tz) {
	const sameYear = wallOf(startTs, tz).y === wallOf(endTs, tz).y;
	return sameYear ? `${fmtMdHm(startTs, tz)} ~ ${fmtMdHm(endTs, tz)}` : `${fmtYmdHm(startTs, tz)} ~ ${fmtYmdHm(endTs, tz)}`;
}

function gameIconGlyph(name) {
	const s = String(name == null ? "" : name).replace(/[\s\u3000]+/g, "");
	if (!s) return "?";
	// 优先取第一个汉字/假名/字母/数字（跳过「·」「：」「！」这类分隔符与符号）
	const m = s.match(/[\u4e00-\u9fff\u3040-\u30ffA-Za-z0-9]/);
	return m ? m[0].toUpperCase() : s.charAt(0);
}
function GameIcon({ icon, name, size }) {
	const px = size || 20;
	const [failed, setFailed] = (0, react.useState)(false);
	(0, react.useEffect)(() => { setFailed(false); }, [icon]);
	const box = { width: px, height: px, borderRadius: 5, flex: "none" };
	if (!icon || failed) {
		// B3：这里原先多挂了一个 className:"gacha-cal-icon-fb" —— 70-styles.js 里**没有**这条规则
		// （该元素的造型全在下面的 inline style 上），删掉它视觉零变化（真机 computed 样式逐项相同）。
		return (0, react_jsx_runtime.jsx)("span", {
			"aria-label": name,
			title: name,
			style: Object.assign({}, box, {
				display: "inline-flex", alignItems: "center", justifyContent: "center",
				background: "var(--dsw-alias-bg-l2, rgba(127,127,127,.2))",
				color: "var(--dsw-alias-text-l2, inherit)",
				fontSize: Math.round(px * 0.55), fontWeight: 600, lineHeight: 1,
				userSelect: "none", overflow: "hidden"
			}),
			children: gameIconGlyph(name)
		});
	}
	return (0, react_jsx_runtime.jsx)("img", {
		src: icon, alt: name, loading: "lazy", decoding: "async", style: Object.assign({}, box, { objectFit: "cover" }),
		onError: () => setFailed(true)
	});
}

const SCHEDULE_DAYS = 14;                 // 迷你条与表头刻度共用的天数（所有行同一根轴）
const SCHEDULE_TODAY_INDEX = 2;           // 今天在这一轴上的格号（0 基）→ 今天恒为第 3 格
const SCHEDULE_LONG_MS = 366 * 864e5;     // 窗口超过一年 = 长期档期（pjsk 那种 2099 哨兵）
const SCHEDULE_DUE_MS = 864e5;            // 24 小时内到期 = "今天到期"
const SCHEDULE_AMBER_MS = 7 * 864e5;      // 一周内 = 一段琥珀文字（本周留意）
const SCHEDULE_WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
// 这一款游戏的代表色：**与设置页取色器共用同一份实现**（src/game-color.js）
const scheduleGameColor = gameColor;

// ── 档期文本的两套口径（用户 2026-10-21 定）────────────────────────────────
//   · **外显**（面板上看得见的时间文本）= 按**用户本机时区**换算后的时间 ——
//     玩家要回答的是"我这边几点能抽"，所以换算成手机/电脑的钟点。
//   · **悬停**（tooltip / 探头展开行）= **源站墙钟原文** —— 对着游戏内公告核对用，
//     解析器输出的 bannerDates / eventDates 就是这串原文，渲染层的 title 一律不动。
//
// ⚠️ 为什么不直接吃 `startTs/endTs`：落盘数据里没有它们 —— `50-refresh.js` 的
//    GACHA_FIELDS / EVENT_FIELDS 只留文本与悬停（事件侧本来也没有 eventStartTs/eventEndTs）。
//    但每条来源都带源站 `tz`（`60-helpers.js` 的 getAllEntries 白名单里透传），
//    而源站文本就是"源站墙钟" ⇒ 「文本 + tz」足以还原绝对时刻，再按本机时区渲染。

// 绝对档期 → 本机时区文本（不传 tz = 运行环境本机时区）。拿不到绝对档期 → null。
function localWin(startTs, endTs) {
	if (typeof startTs === "number" && typeof endTs === "number") return fmtWindow(startTs, endTs);
	return null;
}

// 源站墙钟文本 + 源站 tz → 本机时区文本。
// 返回 null = 换算不了（调用方回落原文，**绝不**显示一个错的钟点）：
//   · 文本不是「MM-DD HH:MM ~ MM-DD HH:MM」形态（跨年带年份 / "版本更新后 ~ …" / "长期"）
//   · 条目没声明 tz（自定义条目；`sourceOffsetMinutes` 也不认识的时区名）
function localWinText(text, tz, now) {
	if (!tz) return null;
	const r = parseDisplayRange(text, now);
	if (!r) return null;
	// 把"被当成本机墙钟"解释出来的 ts 还原成绝对时刻：真值 = ts + (本机偏移 − 源站偏移)。
	// 两端各算一次（跨 DST 的窗口不会因为只取起点偏移而差一小时）。
	const shiftOf = (ts) => {
		const offSrc = sourceOffsetMinutes(tz, ts);
		if (offSrc == null) return null;
		return (-new Date(ts).getTimezoneOffset() - offSrc) * 60000;
	};
	const sa = shiftOf(r.startTs), sb = shiftOf(r.endTs);
	if (sa == null || sb == null) return null;
	if (sa === 0 && sb === 0) return text;   // 源站时区 == 本机 → 原文即换算结果（保持原样，不重排）
	return fmtWindow(r.startTs + sa, r.endTs + sb);
}

// 某条目某一侧的外显档期文本：绝对档期 → 「源站文本 + tz」→ null（调用方回落原文）。
// 卡池侧若数据里直出了 startTs/endTs（fetch 层契约里有）就优先用它们；
// 活动侧没有对应字段（不拿卡池的 startTs 冒充），一律走文本 + tz。
function localDatesOf(g, isG, now) {
	if (!g) return null;
	const hit = isG ? localWin(g.startTs, g.endTs) : null;
	if (hit) return hit;
	const text = (isG ? g.bannerDates : g.eventDates) || "";
	return localWinText(text, g.tz || null, now);
}

// 一条档期 = 某款游戏的卡池侧或活动侧。读不出绝对档期的（源站原文）按"长期"处理，
// **不**硬凑一个天数——这也是设计稿里"点线 + 长期"两字的来由。
function scheduleNormalize(g, side, now) {
	const isG = side === "gacha";
	const title = (isG ? g.banner : g.event) || "";
	// 源站墙钟原文（悬停用）与换算后的外显文本（本机时区）分开存：
	//   rawSrc = 源站原文；raw = 外显（换算不了就回落 rawSrc）
	const rawSrc = (isG ? g.bannerDates : g.eventDates) || "";
	const raw = localDatesOf(g, isG, now) || rawSrc;
	if (!title && !raw) return null;                       // 这一侧没有数据，不出条目
	const fail = (isG ? g.gachaFail : g.eventFail) || null;
	const r = parseDisplayRange(raw, now);
	let state = "long", startTs = 0, endTs = 0;
	if (r) {
		startTs = r.startTs;
		endTs = r.endTs;
		const span = Math.max(1, endTs - startTs);
		if (span > SCHEDULE_LONG_MS) state = "long";
		else if (now.getTime() < startTs) state = "wait";
		else if (now.getTime() > endTs) state = "ended";
		else state = "live";
	}
	const remain = state === "live" ? Math.max(0, endTs - now.getTime()) : 0;
	// 外显文本：卡池侧优先显示**去修饰的角色名**（旧面板一直这么显示），没有角色名就退回卡池标题；活动侧仍是活动名
	const roles = isG ? (g.roles || "") : "";
	const show = (isG && roles) ? (cleanRoleNames(roles, g.id) || title) : title;
	// 悬停文本：**原始文本** = 标题 + 源站原文（优先 Raw），与旧面板 gachaTitle/eventTitle 的写法一致
	const datesRaw = (isG ? g.bannerDatesRaw : g.eventDatesRaw) || rawSrc;
	const orig = title + (datesRaw ? "\n" + datesRaw : "");
	return { key: g.id + ":" + side, g, side, isG, title, show, orig, raw, rawSrc, fail, state, startTs, endTs, remain };
}

// ── 同格并列条目：从悬停文本解析出来 ─────────────────────────────────────────
// 引擎只给**一条外显条目** + 一段供悬停用的多行文本（bannerHover / eventHover），**没有**并列数组。
// 契约（25-parser-shared.js 的 hoverPool / hoverEvent / buildPoolHover / buildEventHover）：
// 当期 ≥2 条时每条一行、不足 2 条时给空串，且三种排版：
//   · 活动式 —— 每条自带档期：`名称   MM-DD HH:MM ~ MM-DD HH:MM`
//   · 卡池式 —— 档期另起一行：`池名：角色` ⏎ `MM-DD HH:MM ~ MM-DD HH:MM`
//   · 两者在"窗口完全相同"时都只在**末尾**写一遍档期
// ⚠️ 鸣潮的卡池悬停（30-game-kuro.js）首行还多带一个"卡池类型"，它就等于外显标题 → 丢掉那一行。
// 解析不出（或结果少于 2 条）一律返回空，调用方回退到外显那一条 —— 宁可少列，绝不列错。
const SCHEDULE_WINDOW_LINE = /^(?:\d{4}-)?\d{1,2}-\d{1,2} \d{1,2}:\d{2} ~ (?:\d{4}-)?\d{1,2}-\d{1,2} \d{1,2}:\d{2}$/;
const SCHEDULE_INLINE_WINDOW = / (?:\d{4}-)?\d{1,2}-\d{1,2} \d{1,2}:\d{2} ~ (?:\d{4}-)?\d{1,2}-\d{1,2} \d{1,2}:\d{2}$/;
const scheduleNoYear = (x) => String(x).replace(/(\d{4})-(\d{1,2}-\d{1,2})/g, "$2");
function scheduleHoverItems(hover, shownTitle, isG) {
	const lines = String(hover || "").split("\n").map((x) => x.trim()).filter(Boolean);
	if (lines.length < 2) return [];                        // 契约：只有 1 条时给的是空串
	// ⚠️ 这里**不要**再去丢"首行等于外显标题"的那一行（我曾这么写，结果把终末地的真池子丢了：
	// 「终末地」常驻寻访 正好既是外显标题、又是悬停里的第 1 个池子）。
	// 重复项（含鸣潮那个"卡池类型"首行，它等于外显标题）由 scheduleHoverOnes 按标题去重处理。
	const rest = lines.filter((x) => !/^以及常驻活动/.test(x));
	const out = [];
	let pending = [];                                       // 卡池式：先攒名称，等下一行（或后面某行）的档期
	for (const line of rest) {
		const inline = line.match(SCHEDULE_INLINE_WINDOW);
		if (inline && inline.index > 0) {                   // 活动式：名称 + 自己的档期
			const win = inline[0].trim();
			for (const t of pending.concat([line.slice(0, inline.index).trim()])) out.push({ title: t, win });
			pending = [];
			continue;
		}
		if (SCHEDULE_WINDOW_LINE.test(line)) {              // 纯档期行
			if (pending.length) for (const t of pending) out.push({ title: t, win: line });
			else if (out.length) out[out.length - 1].win = line;   // 窗口完全相同：给上一条补上档期
			pending = [];
			continue;
		}
		pending.push(line);
	}
	// ⚠️ 同一口池在数据里有两种写法，一起摆进探头就是"看起来重复"（用户 2026-10-16）：
	//    · 引擎的 roles 只给角色名 ——「克莱门莎」
	//    · 悬停原文给「池名：角色」——「海渊巡游：克莱门莎」「「微醺茶香，藤花幽梦」：仙踪良梦」
	//    用户定的口径：**只显示角色名那条** ⇒ 谁被另一条整个包住，就留谁、把带池名的那条丢掉。
	//    另外：完全同名（战双帕弥什「新增涂装」×6、原神「绮星盛会」×2）只留第一条。
	//    ⚠️ 只认「：」两侧的整段（不做任意子串）——否则「夏日活动」会被当成「夏日活动·特别篇」的重复。
	const normTitle = (s) => String(s || "").replace(/[（(][^）)]*[）)]/g, "").replace(/\s+/g, "");
	// A 是不是「池名：B」或「B：其余」这种把 B 整个包住的写法（B 通常就是那条只有角色名的）
	const wraps = (A, B) => {
		const la = normTitle(A), lb = normTitle(B);
		if (lb === "" || la === lb) return false;
		if (la.indexOf(lb + "\uFF1A") === 0) return true;
		const tail = la.lastIndexOf("\uFF1A" + lb);
		return tail >= 0 && tail === la.length - lb.length - 1;
	};
	const kept = [];
	const seenTitle = new Set();
	for (const a of out) {
		const la = normTitle(a.title);
		if (la && seenTitle.has(la)) continue;              // 完全同名 ⇒ 只留第一条
		if (out.some((b) => b !== a && wraps(a.title, b.title))) continue;   // a 包着别人 ⇒ 丢 a，留被包住的那条
		if (la) seenTitle.add(la);
		kept.push(a);
	}
	// ⚠️ 这里**只**在一条都不剩时收手。老写法是"少于 2 条就当没有"，那是为
	//    "外显与探头会重复"的旧模型准备的；现在外显固定为列表第 0 条、且同池已去重，
	//    只剩 1 条并列池时必须照常列出来（否则那口池在面板上彻底看不见，用户 2026-10-16）。
	if (kept.length < 1) return [];
	return kept;
}
// 把 { title, win } 补成与 scheduleNormalize **同形**的条目（渲染层只认这一种形状）
function scheduleHoverOnes(items, it, now) {
	const out = [];
	for (const x of items) {
		if (x.title === it.title) continue;                  // 外显那条已经有了，不重复列
		// ⚠️ 外显那条（引擎 roles → 通常只有角色名，如「克莱门莎」）与这里的「池名：角色」
		//    （如「海渊巡游：克莱门莎」）常常是同一口池 ⇒ 按用户口径"只显示角色名那条"，
		//    外显已经占了角色名，这里就不再把同一口池列一遍（用户 2026-10-16）。
		//    ⚠️ 必须在**这一层**做：scheduleHoverItems 只看得到悬停解析出的条目，
		//    看不到 it（外显那条）⇒ 上一版规则所以在真机上完全不起作用。
		const normOne = (s) => String(s || "").replace(/[（(][^）)]*[）)]/g, "").replace(/\s+/g, "");
		const shownText = normOne(it.show || it.title || "");
		const titleText = normOne(x.title);
		if (shownText && titleText && titleText !== shownText) {
			const tailAt = titleText.lastIndexOf("\uFF1A" + shownText);
			if (titleText.indexOf(shownText + "\uFF1A") === 0 || (tailAt >= 0 && tailAt === titleText.length - shownText.length - 1)) continue;
		}
		const r = parseDisplayRange(scheduleNoYear(x.win), now);
		if (!r) continue;                                    // 读不出绝对档期 → 不硬凑天数
		const span = Math.max(1, r.endTs - r.startTs);
		let state = "long", remain = 0;
		if (span > SCHEDULE_LONG_MS) state = "long";
		else if (now.getTime() < r.startTs) state = "wait";
		else if (now.getTime() > r.endTs) state = "ended";
		else { state = "live"; remain = Math.max(0, r.endTs - now.getTime()); }
		out.push({ key: it.key, g: it.g, side: it.side, isG: it.isG, title: x.title, raw: x.win, fail: null, state, startTs: r.startTs, endTs: r.endTs, remain });
	}
	return out;
}

// 倒计时只给"数字 + 单位"，标签（还剩 / 之后开始）由渲染层写 —— 同一个位置不会一会儿"还剩"
// 一会儿"距开始"。
function scheduleCountdown(ms) {
	if (!(ms > 0)) return [["0", "分"]];
	const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5), mi = Math.floor((ms % 36e5) / 6e4);
	if (d > 0) return [[String(d), "天"], [String(h), "时"]];
	if (h > 0) return [[String(h), "时"], [String(mi), "分"]];
	return [[String(mi), "分"]];
}

// 迷你条的 14 天轴：从"今天前 2 天"起 → 今天恒为第 3 格，与刻度、竖线天然对齐。
function scheduleDays(now) {
	const out = [];
	for (let i = 0; i < SCHEDULE_DAYS; i++) {
		out.push(new Date(now.getFullYear(), now.getMonth(), now.getDate() - SCHEDULE_TODAY_INDEX + i));
	}
	return out;
}

const schedule2 = (n) => (n < 10 ? "0" + n : String(n));
function scheduleMD(ts) { const d = new Date(ts); return schedule2(d.getMonth() + 1) + "-" + schedule2(d.getDate()); }
function scheduleHHMM(ts) { const d = new Date(ts); return schedule2(d.getHours()) + ":" + schedule2(d.getMinutes()); }
// 源站常常只给日期：没有具体时刻就不写时刻（写 00:00 是假精度）
function scheduleMDHM(ts) { const d = new Date(ts); return scheduleMD(ts) + (d.getHours() || d.getMinutes() ? " " + scheduleHHMM(ts) : ""); }
function scheduleSameDay(ts, now) {
	const d = new Date(ts);
	return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

// 「时间结论」只用**文字**表达紧迫度（颜色已让给"认游戏"）。parts 非空时渲染成"数字 + 小号单位"。
function scheduleWhen(it, now) {
	if (it.state === "wait") return { text: scheduleMDHM(it.startTs) + " 开始", parts: null };
	if (it.state === "long") return { text: "长期", parts: null };
	if (it.state === "ended") return { text: "已结束", parts: null };
	if (it.remain <= SCHEDULE_DUE_MS && scheduleSameDay(it.endTs, now)) {
		return { text: "今天 " + scheduleHHMM(it.endTs) + " 到期", parts: null };
	}
	const parts = scheduleCountdown(it.remain);
	return { text: "还剩 " + parts.map((p) => p[0] + p[1]).join(""), parts };
}

// 表格单元格的副标题 = 「档期 · 状态」（设计稿的 `.cm`）
function scheduleMeta(it, now) {
	const w = scheduleWhen(it, now);
	if (it.state === "long" && !it.endTs) return "无结束时间 · 长期";
	if (it.state === "wait") return w.text + " · 至 " + scheduleMDHM(it.endTs);
	return scheduleMDHM(it.startTs) + " → " + scheduleMDHM(it.endTs) + " · " + w.text;
}

// 一格里"露哪一条"的次序：在期 > 即将开始 > 长期 > 已结束（横跨所有游戏排「近期」也用同一把尺）。
function scheduleRank(x) {
	if (x.state === "live") return x.remain <= SCHEDULE_DUE_MS ? 0 : 1;
	if (x.state === "wait") return 2;
	if (x.state === "long") return 3;
	return 4;
}
function schedulePickItem(a, b) {
	const ra = scheduleRank(a), rb = scheduleRank(b);
	if (ra !== rb) return ra - rb;
	if (ra <= 1) return a.endTs - b.endTs;
	if (ra === 2) return a.startTs - b.startTs;
	if (ra === 4) return b.endTs - a.endTs;          // 已结束的：最近结束的在前
	return 0;
}

// 紧迫度 → 文字色档位（"1" = 今天到期 / "2" = 一周内 / 其余不标色）。**只用于文字**
function scheduleUrgency(x) {
	if (x.state !== "live") return void 0;
	if (x.remain <= SCHEDULE_DUE_MS) return "1";
	if (x.remain <= SCHEDULE_AMBER_MS) return "2";
	return void 0;
}

// 类型图标：**内联 SVG**（卡池 = 菱形星芒 / 活动 = 旗帜）。两者**形状不同** → 不靠颜色也能分辨，
// 也不用 emoji（用户明确说 emoji 丑）。旁边的文字标签由 CSS 隐藏，见 70-styles.js。
// 悬停明细：**原面板那套**（引擎的 bannerHover / eventHover —— 当期 ≥2 条时每条一行，
// 形如「池名：角色 ⏎ 档期」或「活动名 + 3 空格 + 档期」）。没有并列条目时给空串 →
// 退化成「外显 ⏎ 档期」，与原面板单条时的观感一致。
	function scheduleHoverText(x) {
		const hv = (x.isG ? x.g.bannerHover : x.g.eventHover) || "";
		// 悬停一律给**源站墙钟原文**（rawSrc）；换算后的本机时区文本只用于外显
		const head = [x.title, x.rawSrc || x.raw].filter(Boolean).join("\n");
		return [hv, head].filter(Boolean).join("\n") || "—";
	}
	function scheduleKindIcon(kind, cls) {
	const box = { className: cls, viewBox: "0 0 12 12", "aria-hidden": "true", focusable: "false" };
	if (kind === "gacha") {
		return (0, react_jsx_runtime.jsx)("svg", Object.assign({}, box, {
			fill: "currentColor",
			children: (0, react_jsx_runtime.jsx)("path", { d: "M6 .9 8.1 3.9 11.1 6 8.1 8.1 6 11.1 3.9 8.1 .9 6 3.9 3.9z" })
		}));
	}
	return (0, react_jsx_runtime.jsxs)("svg", Object.assign({}, box, {
		fill: "none", stroke: "currentColor", strokeWidth: "1.3",
		children: [
			(0, react_jsx_runtime.jsx)("path", { d: "M2.4 1.4v9.2" }),
			(0, react_jsx_runtime.jsx)("path", { d: "M2.4 2.1h7.2L7.8 4.2l1.8 2.1H2.4z", fill: "currentColor", stroke: "none" })
		]
	}));
}
// 刷新失败横条的警示图标。设计稿这里放的是一个警告表情 —— 用户明确说 emoji 丑，故同样换成内联 SVG。
function scheduleWarnIcon(cls) {
	return (0, react_jsx_runtime.jsxs)("svg", {
		className: cls, viewBox: "0 0 12 12", fill: "none", stroke: "currentColor",
		strokeWidth: "1.3", strokeLinecap: "round", "aria-hidden": "true", focusable: "false",
		children: [
			(0, react_jsx_runtime.jsx)("path", { d: "M6 1.5 11.1 10.5H.9z" }),
			(0, react_jsx_runtime.jsx)("path", { d: "M6 4.6v2.5" }),
			(0, react_jsx_runtime.jsx)("circle", { cx: "6", cy: "8.9", r: ".6", fill: "currentColor", stroke: "none" })
		]
	});
}
// 底栏「刷新」按钮的图标：顺时针循环箭头（自绘内联 SVG，不用 emoji/外链）。
function scheduleRefreshIcon(cls) {
	return (0, react_jsx_runtime.jsxs)("svg", {
		className: cls, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor",
		strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round",
		"aria-hidden": "true", focusable: "false",
		children: [
			(0, react_jsx_runtime.jsx)("path", { d: "M13.5 8a5.5 5.5 0 1 1-1.9-4.16" }),
			(0, react_jsx_runtime.jsx)("path", { d: "M13.6 2.2v3.3h-3.3" })
		]
	});
}
// GameIcon 自带 5px 圆角；这里用外层方框定尺寸/圆角/描边（多出来的圆角由 overflow 裁掉）。
// 尺寸与设计稿一致：近期行 26（图 24 + 1px 描边）、游戏表 40（图 38 + 1px 描边）。
function scheduleIcon(cls, g, size) {
	return (0, react_jsx_runtime.jsx)("span", {
		className: cls,
		children: (0, react_jsx_runtime.jsx)(GameIcon, { icon: g.icon, name: g.name, size })
	});
}
// 14 天迷你条：**所有行共用同一根轴**（与表头刻度同列宽），所以今天只有一列 ——
// 第 3 格画一道深色竖线，与刻度上的今天对齐。图案只表状态，颜色来自该行的 `--gf`（见 70-styles.js）。
//
// ⚠️ 两种状态**不在这根轴上**，整条做成"图案状态块"（设计稿对"长期"就是这么画的）：
//   · 长期（无结束时间）→ 整条点线
//   · 已结束，且窗口整段都在轴之前 → 整条斜纹
//   为什么必须给"已结束"兜这一下：轴是"今天前 2 天起共 14 天"，而解析器只产出**覆盖当前时刻**
//   的当期条目 —— 已结束的条目只会从"刷新失败沿用上次成功数据"这类旧值里读到，那时它整段都在
//   轴之前；逐格按位置填就一格都不亮，"斜纹 = 已结束"在图例里便成了永远见不到的空话。
//   代价：这种情况位置不再准确（它本来也不在窗口里），但起止日期就写在上面的「档期 · 状态」里。
function scheduleBars(it, days) {
	const state = !it ? "none" : it.state === "ended" ? "done" : it.state;
	const marker = !it ? "" : it.state === "ended" ? "done" : it.state === "long" ? "long" : "1";
	let onAxis = false;
	for (let i = 0; i < days.length && !onAxis; i++) {
		const from = days[i].getTime();
		const to = i + 1 < days.length ? days[i + 1].getTime() : from + 864e5;
		onAxis = !!it && it.endTs > from && it.startTs < to;
	}
	const whole = !!it && (it.state === "long" || (it.state === "ended" && !onAxis));
	const cells = [];
	for (let i = 0; i < days.length; i++) {
		const from = days[i].getTime();
		const to = i + 1 < days.length ? days[i + 1].getTime() : from + 864e5;
		const attrs = { key: i };
		if (it && (whole || (it.endTs > from && it.startTs < to))) attrs["data-f"] = marker;
		if (i === SCHEDULE_TODAY_INDEX) attrs["data-today"] = "true";
		cells.push((0, react_jsx_runtime.jsx)("i", attrs));
	}
	return (0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-sched-tl", "data-state": state, children: cells });
}
// ── 「另有 N 条」的条数从哪来 ─────────────────────────────────────────────
// 注：原先这里有一段「按悬停文本数并列条数」的 scheduleParallelCount（靠正则猜三种排版），
// 用于旧格子里的「另有 N 条」。2026-10-15 大列表改为「探头 + 悬停覆盖展开」后不再需要，
// 已整段删除（连同两条只服务于它的正则）—— 少一处脆弱的文本解析。

// 底部「上次更新 X 分钟前」：只给玩家日常说法，不写绝对时间戳（绝对时间在悬停里）。
function scheduleAgo(ts, now) {
	const t = Number(ts) || 0;
	if (t <= 0) return "尚未更新";
	const min = Math.floor(Math.max(0, now.getTime() - t) / 6e4);
	if (min < 1) return "刚刚";
	if (min < 60) return min + " 分钟前";
	const h = Math.floor(min / 60);
	if (h < 24) return h + " 小时前";
	return Math.floor(h / 24) + " 天前";
}


// 日程面板本体。props 全部来自 CalendarPanel（同一份渲染快照）；组件自身**没有** UI 状态 ——
// 设计稿要求"不折叠、不点开"，所以旧版的"展开更多"连同它的 useState 一起删了。
// 通用循环器：每 seconds 秒把 step 推一格（count 格一轮）；paused 时不排下一拍。
// 近期分页与留白卡共用；模块级 hook ⇒ 组件身份稳定，状态不会被父级重渲染重置。
function useCycle(count, seconds, paused) {
	const [step, setStep] = (0, react.useState)(0);
	(0, react.useEffect)(() => {
		if (paused || count <= 1) return;
		const t = window.setInterval(() => setStep((v) => (v + 1) % count), seconds * 1000);
		return () => window.clearInterval(t);
	}, [count, seconds, paused]);
	return count > 0 ? step % count : 0;
}
// 探头定位：按格子实测写 --rx/--ry/--rw（左右各补 6px 盖住网格间隙）。
// 之所以用 fixed：absolute 的探头会把滚动容器"撑长"（实测悬停时 +133px），
// 靠下的格子一展开面板内容就变长 ⇒ 滑块缩短 / 滚动锚定位移 = 用户看到的"抽搐"。
// 代价是 fixed 用的是**视口坐标**，会随滚轮失效 ⇒ 由 slotScroll 在滚动时对这些变量重算。
function slotPlace(el) {
	if (!el) return;
	const b = el.getBoundingClientRect();
	// 上移 12px 让展开态与**收起态的那 12px 虚影条**对齐（原版行为）。
	// 扩展侧改版曾按"虚影条不常驻"把上下排列的 lift 设为 0，但虚影条已恢复常驻
	// （它是"此处可展开"的提示）⇒ 这里回到统一的 12px，展开时正好从虚影条的位置拉开。
	const lift = 12;
	el.style.setProperty("--rx", (b.left - 6) + "px");
	el.style.setProperty("--ry", (b.bottom - lift) + "px");
	el.style.setProperty("--rw", (b.width + (el.getAttribute("data-t") === "gacha" ? 12 : 14)) + "px");
}
// 当前被悬停的格子只记一个：滚动时只重定位它 —— 不再用 :hover 查询（那会强制样式计算与命中测试），
// 且合并到每帧一次（rAF），否则滚轮每 16ms 就强制一次同步布局，滚动会一顿一顿的。
let slotHeld = null;
let slotRaf = 0;
function slotEnter(el) { slotHeld = el; slotPlace(el); }
function slotLeave(el) { if (slotHeld === el) slotHeld = null; }
function slotScroll() {
	if (!slotHeld || slotRaf) return;
	slotRaf = window.requestAnimationFrame(() => {
		slotRaf = 0;
		if (slotHeld) slotPlace(slotHeld);
	});
}

// 展开的探头是 position:fixed ⇒ 指针在它上面时滚动链挂在视口上、不经过面板视图，滚轮会像被吃掉。
// 但又不能靠 pointer-events:none 放行：那样指针会穿透到下面那一行、把别人的探头激活（用户明确不要）。
// 所以：探头照旧接管指针（挡住下面那行），滚轮在这里手动转交给面板视图。
// 这里**不做 rAF 合并**：每个滚轮事件立即写一次 scrollTop —— 这正是浏览器原生滚动的节奏，
// 同一帧内的多次写会被浏览器合并成一次绘制；合并到 rAF 反而多等一帧、手感发涩。
//
// 🔴 后续待办（用户 2026-10-16 明确列入）：**优化滚动手感**。
//    现状的硬约束：fixed 元素的滚动链挂在视口上 ⇒ 指针在探头上时，浏览器不会把滚轮交给面板；
//    而"滚轮原生"要求探头待在滚动容器**内部** ⇒ 容器必然裁它（末行探头会被面板下沿切掉）。
//    两条无法同时成立，目前选的是"探头稳定、伸得出面板、挡住下面那行"，滚轮用脚本转交。
//    可尝试的方向（都还没做）：
//      a) 探头 pointer-events:none（滚轮落回容器 ⇒ 原生），另在容器内放一层透明"挡板"负责命中，
//         挡板撑出的那点高度用容器底部预留吸收；
//      b) 把探头 DOM 挪成**滚动容器的兄弟节点**（既不裁、也不撑大），坐标由 JS 给；
//      c) 等探头高度能被压到很小（一两条）时，重新评估是否值得为此引入 JS。
function slotWheel(e) {
	const el = e && e.currentTarget;
	if (!el || !el.closest) return;
	// 真正的滚动容器是 .gacha-cal-sched-body（overflow:auto）。
	// ⚠️ 以前这里取的是 .gacha-cal-sched —— 那是**卡片本身**（overflow:hidden、高度自适应 ⇒ 永不溢出）
	//    ⇒ `scrollTop += deltaY` 等于空操作：指针停在探头上滚轮时，面板纹丝不动
	//    （审计 2026-10-16 真机实测：card.scrollTop 恒为 0，body.scrollTop 才能真的滚）。
	const v = el.closest(".gacha-cal-sched-body") ||
		((el.closest(".gacha-cal-sched") || document).querySelector(".gacha-cal-sched-body"));
	if (v && v.scrollHeight > v.clientHeight) v.scrollTop += e.deltaY;
}
// ── 留白卡（模块作用域）──────────────────────────────────────────────
// ⚠️ 必须定义在这里，不能定义在 ScheduleView 内部：
// 父组件每秒都会重渲染（时钟 setNow），定义在里面的组件每次都是**新的函数身份**，
// React 会当作另一种组件 → 卸载重建 → useState 被重置 → 悬停暂停当场失效。
// 这里同时把隐式依赖的 now 改成显式参数。
	// ④ 留白区：「按顺序循环」的卡（背景与主体都取该条目自己的强调色）
	//    大图标当主体；环 = 该档期"已过多少"；下面两行是再往后两件（各两行）。
	//    数据全部取自条目已有的 startTs/endTs/raw，不需要任何新抓取。
	//
	//    ⚠️ 这里曾经写成"纯 CSS 关键帧动画 + DOM 事件钉帧 + 离开时旋转轮次续播 + 0.384s 魔数"，
	//    起因是我误判"本插件环境 hook 不可靠"（依据只有一次 inline style 为空的观察）。
	//    实际上插件里 hook 用得很密（GameIcon 75 行就在用 useState/useEffect），
	//    所以按常规写法重做：**组件内 useState 推进 + 一层 CSS transition**，
	//    短、可读、无魔数，而且天然满足"悬停停在干净的一帧"（停的就是当前这条，它本来就是 1）。
	function slotFrac(it, now) {
		if (!it || typeof it.endTs !== "number") return 0;
		if (typeof it.startTs === "number" && it.endTs > it.startTs) {
			return Math.min(1, Math.max(0, (now - it.startTs) / (it.endTs - it.startTs)));
		}
		return 0; // 无开始时间（长期/仅知结束）：只画轨道，不假装有进度
	}
	function slotLeftDays(it, now) {
		return Math.max(0, Math.ceil((it.endTs - now) / 86400000));
	}
	// 环：底轨道 + 进度弧（rotate -90 让起点在正上方，与 Apple 一致）
	function slotRing(frac, color, size, stroke) {
		const r = (size - stroke) / 2;
		const c = 2 * Math.PI * r;
		const off = c * (1 - Math.min(1, Math.max(0, frac)));
		return (0, react_jsx_runtime.jsxs)("svg", { width: size, height: size, viewBox: "0 0 " + size + " " + size, children: [
			(0, react_jsx_runtime.jsx)("circle", { className: "gacha-cal-slot-track", cx: size / 2, cy: size / 2, r: r, fill: "none", strokeWidth: stroke }),
			(0, react_jsx_runtime.jsx)("circle", { cx: size / 2, cy: size / 2, r: r, fill: "none", stroke: color, strokeWidth: stroke, strokeLinecap: "round",
				strokeDasharray: c.toFixed(1), strokeDashoffset: off.toFixed(1), transform: "rotate(-90 " + size / 2 + " " + size / 2 + ")" })
		] });
	}
	// 「再往后两件」一行：小环 + 游戏名一行 / 事项名一行 + 剩余天数
	function slotLine(it, now) {
		return (0, react_jsx_runtime.jsxs)("div", { className: "gacha-cal-slot-row", key: it.key, children: [
			slotRing(slotFrac(it, now), slotAccent(it), 22, 3.4),
			(0, react_jsx_runtime.jsxs)("span", { className: "gacha-cal-slot-nm", children: [
				(0, react_jsx_runtime.jsx)("b", { children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: it.g.name }) }),
				(0, react_jsx_runtime.jsx)("i", { children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: it.title }) })
			] }),
			(0, react_jsx_runtime.jsxs)("span", { className: "gacha-cal-slot-dd", children: [
				(0, react_jsx_runtime.jsx)("em", { children: String(slotLeftDays(it, now)) }), " 天后结束"
			] })
		] });
	}
	// ⚠️ 这里**不能**用设置页的覆盖表：slotAccent 定义在 ScheduleView/SlotCard 之外的作用域，
	//    拿不到 gameColorMap（上一版就是在这里踩了 ReferenceError，面板整块渲染失败）。
	//    但留白卡的 --g **就是**用户覆盖色：CalendarPanel 已把覆盖色并进条目的 color
	//    （colorOverrides[g.id] 命中时写 g = { ...g, color: ov }），本函数读 g.color
	//    ⇒ 覆盖色照样生效。旧注释写"留白卡暂时用出厂色/名字哈希、覆盖色只作用于表格行与设置页"
	//    与事实相反（真实行为比那更好）。
	const slotAccent = (it) => scheduleGameColor(it.g);
	// 档期行：有 raw 才补分隔符；没有开始时间就不显示"已过 0%"（那是假信息）
	function slotSub(it, frac) {
		if (typeof it.startTs !== "number") return it.raw || "";
		return (it.raw ? it.raw + " · " : "") + "已过 " + Math.round(frac * 100) + "%";
	}
	const SCHEDULE_SLOT_SECS = 4;
	// 留白卡本体：普通组件（useState 推进 + useEffect 定时），悬停即不再排下一拍
	function SlotCard({ list, now }) {
		const ending = list.filter((x) => x && typeof x.endTs === "number" && x.state !== "long" && x.endTs > now)
			.sort((a, b) => a.endTs - b.endTs);
		const slides = ending;                       // 全部按顺序循环（不再限 6 条）
		const n = slides.length;
		const [held, setHeld] = (0, react.useState)(false);
		const cur = useCycle(n, SCHEDULE_SLOT_SECS, held);
		// 下面三行跟着当前这条走：显示它之后的三个（也就在循环里一起换）；三行正好把卡片垫到与左侧齐平
		const rows = n > 3 ? [ending[(cur + 1) % n], ending[(cur + 2) % n], ending[(cur + 3) % n]] : [];
		if (!n) return (0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-sched-slot gacha-cal-sched-slot--empty" });
		return (0, react_jsx_runtime.jsxs)("div", {
			className: "gacha-cal-sched-slot",
			style: { "--gc": slotAccent(slides[0]) },
			onPointerEnter: () => setHeld(true),
			onPointerMove: marqMove,
			onPointerLeave: () => { setHeld(false); marqClear(); },
			children: [
				// 背景层：撑满整张卡；颜色 = 该条目的强调色（与表格 --gf 同一套规则）
				slides.map((it, i) => (0, react_jsx_runtime.jsx)("span", {
					className: "gacha-cal-slot-bg",
					key: "bg" + i,
					"data-t": it.isG ? "gacha" : "event",
					style: { "--g": slotAccent(it), opacity: i === cur ? 1 : 0 }
				})),
				(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-slot-cine", children: slides.map((it, i) => {
					const color = slotAccent(it);
					const frac = slotFrac(it, now);
					return (0, react_jsx_runtime.jsxs)("div", {
						className: "gacha-cal-slot-slide",
						key: "sd" + i,
						style: { opacity: i === cur ? 1 : 0 },
						children: [
							(0, react_jsx_runtime.jsxs)("div", { className: "gacha-cal-slot-ring", children: [
								slotRing(frac, color, 132, 9),
								(0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-slot-ic", children: (0, react_jsx_runtime.jsx)(GameIcon, { icon: it.g.icon, name: it.g.name, size: 86 }) })
							] }),
							(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-slot-gn", children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: it.g.name }) }),
							(0, react_jsx_runtime.jsxs)("div", { className: "gacha-cal-slot-days", children: [
								(0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-slot-n", children: String(slotLeftDays(it, now)) }),
								(0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-slot-u", children: "天后结束" })
							] }),
							(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-slot-ttl", children: it.title }),
							(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-slot-sub", children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: slotSub(it, frac) }) })
						]
					});
				}) }),
				rows.length ? (0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-slot-more", children: rows.map((x) => slotLine(x, now)) }) : null
			]
		});
	}
// ── 悬停自动滚动（截断文字不显示省略号，改为来回滚全文）——**由面板自己驱动** ──
// 新面板走这里的 React 指针事件（与探头浮层同一套机制）；老面板仍走 90-plugin.js 的
// document 级 mouseover/mousemove/mouseout。两条路径在真鼠标（CDP 可信事件）下**都能工作**：
// 老面板的 .gacha-cal-cell 悬停会加上 .gacha-cal-marq + --gacha-marq-d（transform 真的在动）；
// 新面板「近期」列表的 .gacha-cal-sched-who/.gacha-cal-sched-what 同样生效。
// ⚠️ 此前记的"那条 document 路径在本机对真鼠标不响应（手动 dispatchEvent 能加类、真鼠标不能）"
//    是当时环境下的**误判**（只用合成事件采样，没走真实鼠标）⇒ 该结论已作废。
// 类名/变量沿用老面板那套（CSS 不用动）：
//   .gacha-cal-marq .gacha-cal-inner{animation:gacha-cal-marquee 3.5s …}  +  --gacha-marq-d
const MARQ_SEL = ".gacha-cal-sched-who, .gacha-cal-sched-what, .gacha-cal-slot-gn, .gacha-cal-slot-sub, .gacha-cal-slot-nm b, .gacha-cal-slot-nm i";
let marqEl = null;
function marqClear() {
	if (marqEl) { marqEl.classList.remove("gacha-cal-marq"); marqEl = null; }
}
function marqMove(e) {
	const t = e && e.target;
	const el = t && t.closest ? t.closest(MARQ_SEL) : null;
	if (!el) { marqClear(); return; }
	if (el === marqEl && el.classList.contains("gacha-cal-marq")) return;   // 已经滚着，别每帧重算
	marqClear();
	const inner = el.querySelector(".gacha-cal-inner");
	if (!inner) return;
	const dist = inner.scrollWidth - el.clientWidth;
	if (dist > 0) {
		el.style.setProperty("--gacha-marq-d", "-" + (dist + 8) + "px");
		el.classList.add("gacha-cal-marq");
		marqEl = el;
	}
}
// ── 总览那两段计数（K 版 2026-10-17 / 同日二次微调：改成「永远两段」）─────────────
// 头部那行=「24 小时内 N 条」·「7 天内 M 条」，用共用的 gacha-cal-sched-sep（·）连接。
// 规则（用户明确要求）：**永远显示两段** —— N=0 / M=0 都照常把数字写出来（如「24 小时内 0 条」）；
// **没有**任何"都为 0 就换一句话"的兜底路径（原来的「最近 7 天无事」兜底已删）。
// ⇒ 返回数组长度**恒为 2**，且每项都带 n，渲染侧不需要任何条件分支。
// 纯函数（不碰 React / DOM）⇒ 四种零/非零组合可离线单测；渲染侧只负责把
// label + 粗体数字 + 尾字摆出来（样式沿用 .gacha-cal-sched-glance b 那份）。
function scheduleGlanceSegs(within24, within7) {
	return [
		{ label: "24 小时内 ", n: within24, tail: " 条" },
		{ label: "7 天内 ", n: within7, tail: " 条" }
	];
}
function ScheduleView({ games, now, s, colorMap, refreshing, onRefresh, lastRefreshText, scrapeInfo, scrapeLines, topMode, stacked, nearLimit }) {
	// ══ 扩展侧改版（2026-10-21，有意偏离上游）══════════════════════════════════
	// topMode = "recent" | "slot"
	//   顶部区域**同一个位置**只显示一样：近期列表 或 留白卡（设置页二选一）。
	//   实现上两个都挂载、用 CSS 隐藏未选中的那个 —— 组件结构不动，行为保持可回退。
	// stacked = true
	//   游戏表改为「每款游戏两行」：第一行卡池、第二行活动，左侧游戏名跨两行。
	//   ⚠️ 目的是**节省宽度**（原版是 游戏 | 卡池 | 活动 三列并排）。
	const TOP_SLOT = topMode === "slot";
	const STACKED = stacked === true;
	// 每行不再显示「卡池 / 活动」指示（2026-10-21 定稿：内容本身已足够区分）。
	// 每游戏主题色覆盖表（面板侧；设置组件里另有一份同名的）。
	// ⚠️ 必须在这里也定义一次：下面的行 --g 与留白卡 slotAccent 都在本组件里用它，
	//    漏了就是 ReferenceError ⇒ 整个面板（连带插件 UI）挂不上。
	// T3：改由 CalendarPanel 把**已经解析好的表**传进来（colorMap），消除"同一份 JSON 在
	//     两个组件各 parse 一次"；colorMap 缺席时才退回自己解析（保持组件可独立使用）。
	const gameColorMap = colorMap || parseJsonStr(s.gameColors, {});
	// 每一格（游戏 × 卡池/活动）的候选档期。已结束的**留在格子里**（这一侧没有在期内容时它就是
	// 这格的代表，图案走斜纹），但不进「近期」—— 近期回答的是"现在该看哪几条"。
	// ↓↓↓ 纯派生数据（与 CalendarPanel 同理）：4s 一次的「近期」翻页、每分钟时钟、以及任何
	// 无关设置写入都会让本组件重渲染；这一段原本每次都要逐游戏跑 scheduleNormalize（28×2）
	// ＋悬停文本解析＋失败归类。用 useMemo 按真正输入（games / now）缓存。
	//   ⚠️ 依赖只写 games / now：本段不再读别的可变输入（主题色不参与，见 gameColorMap 只在下游用）。
	const { cells, all, failed, failRows, soonCount } = (0, react.useMemo)(() => {
	const cells = new Map();
	const all = [];
	for (const g of games) {
		for (const side of ["gacha", "event"]) {
			const it = scheduleNormalize(g, side, now);
			if (!it) continue;                       // 这一侧没有任何数据 → 格子里写"该来源无数据"
			// 同格并列多条：**外显那条排最前**，其余由悬停文本解析补上（解析不出、或只有一条 → 就只有外显）。
			// ⚠️ 「近期」只收外显那条（all 的语义不变）—— 大列表改版不动「近期」。
			const extras = scheduleHoverOnes(
				scheduleHoverItems(side === "gacha" ? g.bannerHover : g.eventHover, it.title, it.isG), it, now);					// ⚠️ 外显与探头是**同一份列表**（用户 2026-10-16）。引擎给的 roles 是**跨池合并**的角色表
			// ⚠️ 有并列池时，外显**不能**再显示引擎给的"合并角色表"：
			//    探头会把每个池连角色再列一遍（原神 = 丝柯克/爱可菲 两个池、鸣潮 = 3 个池各列一遍），
			//    同一批角色"先合并说一遍、再分池说一遍"正是用户看到的重复 + 粒度混乱。
			//    所以：有并列池 ⇒ 外显回到池名（角色名在探头的每一池里）；只有一池 ⇒ 外显就是角色名。
			// 外显文本规则**与旧面板完全一致**：卡池侧永远显示"去修饰的角色名"（roles 过 cleanRoleNames），
			// 没有角色名才退回池名/活动名。旧面板就是这么写的（见本文件旧面板分支的 gachaVisible）。
			// ⚠️ 这里曾有一版特例「有并列池就改显池名」（想避免角色名"先说一遍、探头再分池说一遍"），
			//    但那是与旧面板不一致的**显示规则**，用户 2026-10-16 要求对齐 ⇒ 已删除。
			//    并列池的角色名在探头里逐池列，重复问题留着不动（显示规则优先与旧面板一致）。
			cells.set(g.id + ":" + side, [it].concat(extras));
			if (it.state !== "ended") all.push(it);
		}
	}
	const sourceNameOf = (x) => (x.isG ? x.g.source : x.g.eventSource) || "";
	// 刷新失败是**来源级**问题（某个网站抓不到），不属于任何一格 → 底部横条 + 重试
	const failed = [];
	for (const list of cells.values()) for (const x of list) if (isDown(x.fail)) failed.push(x);
	const failRows = failed.map((x) => {
		const reason = (normalizeFail(x.fail) || {}).reason || "";
		return x.g.name + " · " + sourceNameOf(x) + (reason ? " " + reason : "") + " —— 该条沿用上次成功数据";
	});
	// 「24 小时内」= 未来 24 小时内有**开始或结束**的外显条目：startTs 或 endTs 落在 (now, now+24h]。
	// 与旧的「今天到期」不同：这里**开始也算**（原来"即将开始"是另一段，现已并进这一格）。
	// ⚠️ 只数 all（= 每格外显那一条，与「近期」同一份候选）；探头里的并列 extras 不计。
	// ⚠️ 0 值/哨兵不动手：长期档期（endTs=0 或 2099 那种）自然落在窗口外，不需要额外特判。
	const nowMs = now.getTime();
	const soonCount = all.filter((x) => (
		(x.startTs > nowMs && x.startTs <= nowMs + SCHEDULE_DUE_MS) ||
		(x.endTs > nowMs && x.endTs <= nowMs + SCHEDULE_DUE_MS)
	)).length;
	return { cells, all, failed, failRows, soonCount };
	}, [games, now]);
	// ↑↑↑ useMemo 结束（cells / all / 失败归类 / 24 小时计数）
	// 「近期」= **7 天内有事发生**（到期或开始）；更远的只出现在下方游戏表里
	// （用户 2026-10-15：不能把 20 多天后的也算近期）。长期/已结束不进近期。
	const SCHEDULE_NEAR_MS = SCHEDULE_AMBER_MS;
	// 「近期」默认只列前 10 条（已按紧迫度排序），其余靠每 4 秒换一批（取模环绕）循环看到；
	// 底部按钮「展开全部 N 条」= React state（nearAll），展开时列全部并停住循环，再点击是「收起」。
	// ——面板里**没有**「还有 N 条」这个文案，也不再走纯 CSS 的 checkbox。
	// 「近期」每批显示几条（默认最多 2 条；展开后仍可看全部，其余靠 4s 轮换）。
	const SCHEDULE_NEAR_LIMIT = Number.isFinite(nearLimit) && nearLimit > 0 ? Math.floor(nearLimit) : 2;
	const scheduleNear = (x) => (x.state === "wait"
		? x.startTs != null && x.startTs - now.getTime() <= SCHEDULE_NEAR_MS
		: x.state === "live" && x.remain <= SCHEDULE_NEAR_MS);
	// 「近期」列表：只由 all（上面已 memo）+ now 决定（scheduleNear 是纯函数）⇒ 同样缓存。
	const recent = (0, react.useMemo)(
		() => all.filter(scheduleNear).sort((a, b) => schedulePickItem(a, b) || (a.g.name < b.g.name ? -1 : a.g.name > b.g.name ? 1 : 0)),
		[all, now]);
	// 「近期」循环：每 4 秒整体换一批（每批 SCHEDULE_NEAR_LIMIT 条，末页用取模环绕 ⇒ 永远满 10 条、且能转遍全部）。
	// 悬停、或点了「展开全部」时都停住 —— 想看全就展开，想停在某批就把鼠标放上去。
	const [nearHeld, setNearHeld] = (0, react.useState)(false);
	const [nearAll, setNearAll] = (0, react.useState)(false);
	const nearPages = Math.max(1, Math.ceil(recent.length / SCHEDULE_NEAR_LIMIT));
	const nearPage = useCycle(nearPages, SCHEDULE_SLOT_SECS, nearHeld || nearAll);
	const nearRows = (nearAll || recent.length <= SCHEDULE_NEAR_LIMIT)
		? recent
		: Array.from({ length: SCHEDULE_NEAR_LIMIT }, (_, i) => recent[(nearPage * SCHEDULE_NEAR_LIMIT + i) % recent.length]);
	// 14 天轴（days）：原本每次渲染都是新数组 ⇒ 会把下面游戏表的 useMemo 依赖打穿（每帧失效）。
	const days = (0, react.useMemo)(() => scheduleDays(now), [now]);
	// 日期胶囊：设计稿写「10 月 5 日 · 周日」
	const datePill = now.getMonth() + 1 + " 月 " + now.getDate() + " 日 · " + SCHEDULE_WEEKDAYS[now.getDay()];
	// 分隔符：左右各一个**真空格**（不只是 CSS margin）⇒ 文本节点本身就是「… 条 · 7 天内 …」，
	// 复制/朗读/innerText 都拿得到正确间隔（总览现在是**单行内联**布局，空格不会被 flex 吃掉）。
	const sep = () => (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-sched-sep", children: " · " });
	// 表头刻度：两栏各一份（左右共用同一根轴，所以列宽必须与迷你条完全一致）
	const ruler = () => (0, react_jsx_runtime.jsx)("div", {
		className: "gacha-cal-sched-ruler",
		children: days.map((d, i) => (0, react_jsx_runtime.jsx)("span", {
			"data-today": i === SCHEDULE_TODAY_INDEX ? "true" : void 0,
			children: String(d.getDate())
		}, i))
	});
	// 「近期」一行：图标 / 游戏名 / 类型 / 事项名 / 时间结论
	const recentRow = (x) => {
		const w = scheduleWhen(x, now);
		return (0, react_jsx_runtime.jsxs)("div", {
			className: "gacha-cal-sched-u",
			key: x.key,
			"data-u": x.state === "wait" ? "wait" : scheduleUrgency(x),
			children: [
				scheduleIcon("gacha-cal-sched-uic", x.g, 24),
				(0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-sched-who", children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: x.g.name }) }),
				(0, react_jsx_runtime.jsxs)("span", { className: "gacha-cal-sched-kind", "data-t": x.isG ? "gacha" : "event", children: [
					scheduleKindIcon(x.isG ? "gacha" : "event", "gacha-cal-sched-tic"),
					(0, react_jsx_runtime.jsx)("span", { children: x.isG ? "卡池" : "活动" })
				] }),
				(0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-sched-what", title: scheduleHoverText(x), children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: x.title || x.raw || "—" }) }),
				(0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-sched-when gacha-cal-sched-num", children: w.parts
					? ["还剩 ", ...w.parts.map((p) => (0, react_jsx_runtime.jsxs)("span", { children: [p[0], (0, react_jsx_runtime.jsx)("small", { children: p[1] })] }, p[1]))]
					: w.text })
			]
		});
	};
	// 表格里的一格：名称 + 「档期 · 状态」+ 14 天迷你条。**不折叠不点开**：同格多条时露一条 + 「另有 N 条」
	const cellView = (g, side) => {
		const isG = side === "gacha";
		const list = cells.get(g.id + ":" + side) || [];
		if (!list.length) {
			return (0, react_jsx_runtime.jsxs)("div", {
				className: "gacha-cal-sched-cell gacha-cal-sched-cell--none", "data-t": side,
				children: [
					(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-sched-cn", children: "—" }),
					(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-sched-cm gacha-cal-sched-num", children: isG ? "该来源无卡池数据" : "该来源无活动数据" }),
					scheduleBars(null, days)
				]
			});
		}
		// ⚠️ 外显与探头在数据层面就是**同一份列表**：第 0 条 = 引擎那条 =
		//    老面板的外显判定结果（g.roles ? cleanRoleNames(roles) : banner）。
		//    ⇒ 外显**固定为第一条**，其余才按紧迫度排序。
		//    不能让排序把某口并列池顶到外显：那会让外显的文本格式时而是"角色名"、
		//    时而是"池名：角色"（用户 2026-10-16 反馈的"怪怪的"就是这个）。
		//    同池重复已在上游处理（悬停解析那层 + scheduleHoverOnes），这里保证"一口池一条"。
		const sorted = [list[0]].concat(list.slice(1).sort(schedulePickItem));
		const it = sorted[0];
		// 同格多条（2026-10-15 定稿）：**第一条完整三行**（名称 / 档期·状态 / 迷你条），
		// 其余收进「探头」：收起只露顶部 12px 且虚化，悬停时该格底板向下变长**覆盖**下面的行
		// （下面的行位置一格不动、格子高度恒定、文字不位移）。不再写「另有 N 条」文字。
	// 悬停弹出的文本：**照老面板的构造**（旧面板分支 = withFailNote(g.bannerHover || gachaTitle, …)）：
	//   · 引擎给了悬停原文（bannerHover / eventHover：全部当期池/活动的多行原文）就用它 ——
	//     这才是老面板悬停里那段"每口池一行"的文本；没有才退回「名称 ⏎ 档期」。
	//   · 抓取失败/沿用旧数据时补一行「（…）」（老面板同样只在有 note 时补）。
	const hoverTextOf = (x, withFail) => {
		const g = x && x.g;
		if (!g) return (x && (x.orig || x.title || x.raw)) || "—";
		const base = (x.isG ? g.bannerHover : g.eventHover) || "";
		// 悬停（探头展开行同样）用**源站墙钟原文** rawSrc；raw 是本机时区换算后的外显文本
		const own = [x.title, x.rawSrc || x.raw].filter(Boolean).join("\n");
		let text = base ? (base + (x.title && base.indexOf(x.title) < 0 ? "\n" + own : "")) : own;
		if (withFail) {
			const fail = x.isG ? g.gachaFail : g.eventFail;
			const stale = x.isG ? g.gachaStale : g.eventStale;
			const note = sideFailText(x.side, fail, { userSupplied: false });
			if (note) text = stale && text ? text + "\n（" + note + "）" : "（" + note + "）";
		}
		return text || "—";
	};
		const itemOf = (x, key) => (0, react_jsx_runtime.jsxs)("div", {
			key, className: "gacha-cal-sched-item", "data-u": scheduleUrgency(x),
			children: [
				(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-sched-cn", title: hoverTextOf(x, key === "first"), children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-inner", children: x.show || x.title || x.raw || "—" }) }),
				(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-sched-cm gacha-cal-sched-num", children: scheduleMeta(x, now) }),
				scheduleBars(x, days)
			]
		});
		const rest = sorted.slice(1);
		return (0, react_jsx_runtime.jsxs)("div", {
			className: "gacha-cal-sched-cell", "data-t": side, "data-u": scheduleUrgency(it),
			// 展开的探头改成 position:fixed：绝对定位元素会把滚动容器"撑长"（实测悬停时 +133px），
			// 靠下的格子一展开面板内容就变长 ⇒ 滚动条滑块缩短 / 滚动锚定位移 = 用户看到的"抽搐"。
			// fixed 的包含块是视口 ⇒ 既不撑大滚动区、也不会被面板裁掉 —— 真正"伸出面板之外"。
			// 坐标按格子实测写入（--rx/--ry/--rw），滚动时由视图的 onScroll 重算。
			onPointerEnter: (e) => slotEnter(e.currentTarget),
			onPointerLeave: (e) => slotLeave(e.currentTarget),

			children: [
				itemOf(it, "first"),
				rest.length ? (0, react_jsx_runtime.jsx)("div", {
					className: "gacha-cal-sched-rest",
					onWheel: slotWheel,
					children: rest.map((x, i) => itemOf(x, "r" + i))
				}) : null
			]
		});
	};
	// 一行 = 一款游戏（顺序就是传进来的顺序，即设置里拖出来的排列）
	// --z 按**行序递减**：上面的行永远画在下面的行之上（越大越靠上）。
	// 这样"鼠标向上移动"时，上一行正在展开的底板一定压得住下一行尚未收回的内容 ——
	// 不依赖"谁在悬停"（那是会随时间变化的，会出现两格抢层级、下面的字压住上面的底板）。
	const rowOf = (g, i) => (0, react_jsx_runtime.jsxs)("div", {
		className: "gacha-cal-sched-trow" + (STACKED ? " gacha-cal-sched-trow--stacked" : ""),
		key: g.id,
		style: { "--g": scheduleGameColor(g, gameColorMap), "--z": String(900 - i) },
		children: [
			(0, react_jsx_runtime.jsxs)("div", { className: "gacha-cal-sched-gm", title: buildRowTitle(g), children: [
				scheduleIcon("gacha-cal-sched-gic", g, 38),
				(0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-sched-gn", children: g.name })
			] }),
			STACKED
				? (0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-sched-lines", children: [cellView(g, "gacha"), cellView(g, "event")] })
				: [cellView(g, "gacha"), cellView(g, "event")]
		]
	});

	// 游戏表（28 行 × 每行两格 × 14 格迷你条 ≈ 2000~2600 个 <i>）：内容只由
	// games / days / cells / 主题色 / now 决定，与「近期」的 4s 翻页、与无关的设置写入**无关**。
	// 这里缓存**元素本身**：React 对同一 element 引用会直接跳过这棵子树的 render + reconcile
	// （`oldProps === newProps` 的 bailout，与 React.memo 是同一机制）⇒ 4s 翻页不再重算这 2000+
	// 个格子。**DOM、类名、内联变量（--g/--z）、动画标记与关键帧全部不变**（纯实现层缓存）。
	// 依赖必须覆盖 rowOf/cellView 读到的全部输入：games（行序/数据）、days（14 天刻度）、
	// cells（每格候选档期，含 now 结果）、gameColorMap（--g）、now（档期文本/紧迫度）。
	const tableJsx = (0, react.useMemo)(() => (games.length
		? games.map(rowOf)
		: (0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-sched-empty", children: "还没有勾选任何游戏 · 去设置里挑几款" })),
		[games, days, cells, gameColorMap, now]);

	// 「总览」两段的数字（纯函数 scheduleGlanceSegs 决定；**恒为两段**，N/M 是 0 也照写）。
	// ⚠️ 「7 天内」那段的数字 = recent.length = **就是**「近期」底部按钮「展开全部 N 条」的 N
	//    （同一份 recent / 同一套 scheduleNear 判定，见上）—— 绝不另写第二套 7 天条件。
	const glanceSegs = scheduleGlanceSegs(soonCount, recent.length);

	return (0, react_jsx_runtime.jsxs)("div", { className: "gacha-cal-sched", children: [
		// 滚动层：**底栏在它之外**。这样底栏常驻面板下端，而内容在它上沿干净收住，
		// 不会被底栏"浮在上面切成两半"（sticky 的固有毛病，用户反馈"字都看不清"）。
		(0, react_jsx_runtime.jsxs)("div", { className: "gacha-cal-sched-body", onScroll: slotScroll, children: [
		// ① 头部**一行**（K 版 2026-10-17 二次微调）：左=总览 .gacha-cal-sched-glance，右=日期胶囊。
		//    （面板**内**的「二游日历」标题已删，侧栏入口按钮不动。）
		//    ⚠️ 原来的独立 glance 行已并入这里：glance 就是 head 的第一个子元素，两个 flex 子元素
		//      靠 .gacha-cal-sched-sp 的 margin-left:auto 分居两端；head 是 nowrap ⇒ 绝不折成两行。
		//    ⚠️ 动画**分层照旧**：head 命中 .04s 那一拍，glance 自己命中 .09s 那一拍（两条规则都还在）。
		(0, react_jsx_runtime.jsxs)("div", { className: "gacha-cal-sched-head", children: [
			// 总览：**恒为两段**（N/M 为 0 也照显示，没有兜底分支），子元素静态位置 ⇒ 不需要 key。
			(0, react_jsx_runtime.jsxs)("div", { className: "gacha-cal-sched-glance", children: [
				(0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [glanceSegs[0].label, (0, react_jsx_runtime.jsx)("b", { children: String(glanceSegs[0].n) }), glanceSegs[0].tail] }),
				sep(),
				(0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [glanceSegs[1].label, (0, react_jsx_runtime.jsx)("b", { children: String(glanceSegs[1].n) }), glanceSegs[1].tail] })
			] }),
			(0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-sched-sp", children: (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-sched-pill gacha-cal-sched-pill--live", children: datePill }) })
		] }),
		// ③ 「近期」：跨游戏、按紧迫度、全列出；右侧是「下一个截止」卡（见上）
		(0, react_jsx_runtime.jsxs)("div", { className: "gacha-cal-sched-recent gacha-cal-sched-recent--" + (TOP_SLOT ? "slot" : "recent"), children: [
			(0, react_jsx_runtime.jsxs)("div", {
				className: "gacha-cal-sched-urgent",
				onPointerEnter: () => setNearHeld(true),
				onPointerLeave: () => setNearHeld(false),
				children: recent.length
				? (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-sched-nearpg", key: nearAll ? "all" : "p" + nearPage, onPointerMove: marqMove, onPointerLeave: marqClear, children: nearRows.map(recentRow) }),
					recent.length > SCHEDULE_NEAR_LIMIT
						? (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: "gacha-cal-sched-more",
							onClick: () => setNearAll((v) => !v),
							children: [
								(0, react_jsx_runtime.jsx)("span", { children: nearAll ? "收起" : "展开全部 " + String(recent.length) + " 条" }),
								nearAll ? null : (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-sched-page", children: (nearPage + 1) + " / " + String(nearPages) })
							]
						})
						: null
				] })
				: (0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-sched-empty", children: "这段时间没有要盯的档期" })
			}),
			(0, react_jsx_runtime.jsx)(SlotCard, { list: all, now: now })
		] }),
		// ④ 游戏表：**没有区块标题**，列表头直接跟在后面
		(0, react_jsx_runtime.jsxs)("div", { className: "gacha-cal-sched-tcap" + (STACKED ? " gacha-cal-sched-tcap--stacked" : ""), children: [
			(0, react_jsx_runtime.jsx)("span", { children: "游戏" }),
			(0, react_jsx_runtime.jsxs)("span", { className: "gacha-cal-sched-th", "data-t": "gacha", children: [scheduleKindIcon("gacha", "gacha-cal-sched-tic"), "卡池"] }),
			(0, react_jsx_runtime.jsxs)("span", { className: "gacha-cal-sched-th", "data-t": "event", children: [scheduleKindIcon("event", "gacha-cal-sched-tic"), "活动"] })
		] }),
		// 两栏共用同一根 14 天轴：刻度只画一次（左右各一份，列宽与迷你条完全一致）
		(0, react_jsx_runtime.jsxs)("div", { className: "gacha-cal-sched-rulerrow" + (STACKED ? " gacha-cal-sched-rulerrow--stacked" : ""), children: [
			(0, react_jsx_runtime.jsx)("span", {}), ruler(), ruler()
		] }),
		(0, react_jsx_runtime.jsx)("div", { className: "gacha-cal-sched-theadline" }),
		tableJsx,

		] }),
		// ⑦ 底部（**常驻面板下端**）：它在滚动层**之外**，所以内容不会从它下面穿过、也不会被切成两半。
		//    左：刷新成功/失败横幅（旧面板 .gacha-cal-scrape 那条，悬停给逐来源明细）；右：上次更新 + 刷新。
		//    左：刷新成功/失败横幅（就是旧面板 .gacha-cal-scrape 那条，悬停给逐来源明细）；
		//    右：上次更新 X 分钟前 + 刷新。
		(0, react_jsx_runtime.jsxs)("div", { className: "gacha-cal-sched-foot", children: [
			// 扩展侧改版：**失败明细并进这条常驻底栏**（原先滚动区底部还有一条 failbar，
			// 两处说同一件事 ⇒ 已删除 failbar，只保留这里一处）。
			//   有失败：⚠ + 第一条失败明细（悬停看全部），右侧按钮即「重试」；
			//   无失败：保持上游的成功横幅（悬停给逐来源明细）。
			failed.length
				? (0, react_jsx_runtime.jsxs)("span", {
					className: "gacha-cal-sched-scrape gacha-cal-sched-scrape--fail",
					title: failRows.join("\n"),
					children: [
						scheduleWarnIcon("gacha-cal-sched-fic"),
						(0, react_jsx_runtime.jsx)("span", { children: failRows[0] })
					]
				})
				: scrapeInfo ? (0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-sched-scrape", title: (scrapeLines || []).join("\n"), children: scrapeInfo }) : null,
			(0, react_jsx_runtime.jsx)("span", { className: "gacha-cal-sched-when", title: [lastRefreshText, scrapeInfo].concat(scrapeLines || []).filter(Boolean).join("\n"), children: "上次更新 " + scheduleAgo(s.lastRefresh, now) }),
			// 刷新按钮：**图标按钮**，文案/图标不随"有没有失败"变化（失败也只是刷新一次）。
			// refreshing 时图标转圈，与"刷新中"状态一致。
			(0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: "gacha-cal-sched-btn" + (refreshing ? " gacha-cal-sched-btn--busy" : ""),
				disabled: refreshing,
				title: refreshing ? "刷新中..." : "刷新",
				"aria-label": refreshing ? "刷新中..." : "刷新",
				onClick: onRefresh,
				children: scheduleRefreshIcon("gacha-cal-sched-btn-ic")
			})
		] })
	] });
}

// engine：core 引擎（抓取/解析/缓存合并都在里面）。面板只读它返回的 Result JSON。

// 仅导出面板本体；内部辅助函数保持模块私有（与上游一致）。
export { ScheduleView };
