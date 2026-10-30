// 到期提醒的**纯函数移植**：口径一比一照抄 DSH 插件（gacha-calendar-core 0.12.10 的 65-remind.js）。
//
// 为什么移植而不是直接 import core：core 的 `remindItemsOf` / `remindTickOf` / `remindToastOf` /
// `remindTestToastOf` **都没有导出**（既不在 createEngine 的公开 API，也不在 `__test` 里）。
// 所以这里按它的源码逐条抄成纯函数，好处是：
//   · 文案、档位、折叠规则与桌面插件**完全一致**，两边行为不会漂移；
//   · 全是纯函数，可以在 Node 里直接单测（见 tools/test-remind.mjs）；
//   · background（不打包 core）也能用 —— 它只需要这份逻辑，不需要整套抓取引擎。
//
// 与 DSH 的**有意差异**（都因为宿主不同）：
//   1) 时间解析：core 要按源站时区把墙钟换成绝对时间；扩展的 lastData 里 `bannerDates/eventDates`
//      已经是**本机时区**的外显文本（面板怎么显示就怎么存），所以这里直接按本机时区解析。
//   2) 开始方向：core 已停用（startNodes = []）；这里保留同一行为，但数据结构留着，便于将来恢复。
//   3) 送达：core 走 Windows toast（AUMID/身份）；扩展走 chrome.notifications，所以"发送者"就是
//      浏览器/扩展本身，测试通知的正文相应地改一行。

/** 出厂结束档位（小时）：结束后 3 天 / 1 天 / 6 小时 / 2 小时。也是设置页胶囊的可选集合。 */
export const REMIND_DEFAULT_END_NODES = [72, 24, 6, 2];
/** 出厂开始档位（小时）——开始方向暂停用，保留常量。 */
export const REMIND_DEFAULT_START_NODES = [24, 2];
/** 默认应用名（DSH 的 `notifyName` 默认值）。 */
export const NOTIFY_NAME_DEFAULT = "二游日历";

const HOUR_MS = 3600000;
/** 显式空串 / 纯空白 ⇒ "该方向不提醒"本身，不能回落默认。 */
const NODES_EMPTY_RE = /^\s*$/;

/** 条目侧：字段名与 lastData 记录一致。 */
export const REMIND_SIDES = [
	{ side: "gacha", label: "卡池", titleKey: "banner", dateKey: "bannerDates" },
	{ side: "event", label: "活动", titleKey: "event", dateKey: "eventDates" }
];

/**
 * 档位配置的防御性解析（对应 core 的 `remindNodesOf`）：
 *   ① 显式空串 ⇒ 返回 `[]` = 该方向不提醒（**不**回落默认）；
 *   ② 键缺失 / 内容非法 ⇒ 回落 fallback 副本（"配置读坏了"不该让提醒停摆）。
 */
export function remindNodesOf(value, fallback) {
	const out = [];
	const push = (raw) => {
		const n = typeof raw === "string" ? Number(raw.trim()) : raw;
		if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return;
		if (!out.includes(n)) out.push(n);
	};
	if (Array.isArray(value)) value.forEach(push);
	else if (typeof value === "string") {
		if (NODES_EMPTY_RE.test(value)) return [];
		value.split(/[,，\s]+/).forEach(push);
	} else if (typeof value === "number") push(value);
	if (!out.length) return fallback.slice();
	out.sort((a, b) => b - a);
	return out;
}

/** 胶囊点一下 ⇒ 写回的字符串（降序、去重、逗号分隔）；全点掉 ⇒ 空串。 */
export function remindNodesToggleOf(value, node, fallback) {
	const cur = remindNodesOf(value, fallback);
	const n = Number(node);
	const next =
		Number.isFinite(n) && n > 0
			? cur.includes(n)
				? cur.filter((x) => x !== n)
				: [...cur, n]
			: cur.slice();
	next.sort((a, b) => b - a);
	return next.join(",");
}

/** 设置项 → 两套节点（开始方向固定为空，与 DSH 一致）。 */
export function remindConfigOf(input) {
	const raw = input && typeof input === "object" ? input : {};
	return {
		endNodes: remindNodesOf(raw.remindEndNodes, REMIND_DEFAULT_END_NODES),
		startNodes: []
	};
}

/** 去重键：`游戏id|side|end|T`。 */
export function remindKeyOf(item) {
	if (item && typeof item.key === "string" && item.key) return item.key;
	return String(item.gameId) + "|" + String(item.side) + "|" + String(item.kind) + "|" + String(item.T);
}

/** 从键末段取回 T。 */
export function remindTimeOfKey(key) {
	const tail = String(key).split("|").pop();
	const n = Number(tail);
	return Number.isFinite(n) ? n : NaN;
}

/** 状态归一：只留认识的键与 fired 数组，丢掉垃圾。 */
export function remindStateOf(state) {
	const out = {};
	if (!state || typeof state !== "object" || Array.isArray(state)) return out;
	for (const [key, rec] of Object.entries(state)) {
		if (!/^[^|]+\|[a-z]+\|(end|start)\|\d+$/.test(key)) continue;
		const firedRaw = rec && typeof rec === "object" ? rec.fired : null;
		const fired = Array.isArray(firedRaw)
			? firedRaw.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
			: [];
		if (!fired.length) continue;
		out[key] = { fired: [...new Set(fired)].sort((a, b) => b - a) };
	}
	return out;
}

function pad2(n) {
	return (Number(n) < 10 ? "0" : "") + Number(n);
}

/** `MM-DD HH:MM`（本机时区）。 */
export function remindClockOf(ts) {
	const d = new Date(Number(ts));
	if (!Number.isFinite(d.getTime())) return "";
	return pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}

/**
 * 剩余时长的人话（与 DSH 的 `remindSpanText` 逐字一致）：
 *   <1 小时说"分"、<1 天说"小时"、再往上"天 + 小时"（通知里空间够，不往下取整骗人）。
 */
export function remindSpanText(ms) {
	const t = Number(ms);
	if (!Number.isFinite(t) || t <= 0) return "不到 1 分";
	const mins = Math.floor(t / 60000);
	if (mins < 60) return Math.max(1, mins) + " 分";
	const hours = Math.floor(mins / 60);
	if (hours < 24) return hours + " 小时";
	const days = Math.floor(hours / 24);
	const rest = hours % 24;
	return rest > 0 ? days + " 天 " + rest + " 小时" : days + " 天";
}

/** 档位文案：统一按小时说（24 小时比"1 天"更不容易和"还剩 1 天"混淆）。 */
export function remindNodeText(node) {
	const n = Number(node);
	if (!Number.isFinite(n) || n <= 0) return "";
	return n + " 小时";
}

/**
 * 「MM-DD HH:MM ~ MM-DD HH:MM」→ { startTs, endTs }（本机时区；支持带年份的写法）。
 * 解析失败 / 顺序不合法 → null。
 */
export function remindWindowOf(text, nowMs) {
	const parts = String(text || "").split("~").map((x) => x.trim());
	if (parts.length < 2) return null;
	const parsePart = (p) => {
		const m = p.match(/^(?:(\d{4})[-/])?(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/);
		if (!m) return null;
		const mo = Number(m[2]);
		const d = Number(m[3]);
		const h = m[4] ? Number(m[4]) : 0;
		const mi = m[5] ? Number(m[5]) : 0;
		if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
		return { y: m[1] ? Number(m[1]) : null, mo, d, h, mi };
	};
	const a = parsePart(parts[0]);
	const b = parsePart(parts[1]);
	if (!a || !b) return null;
	const baseYear = new Date(Number(nowMs) || Date.now()).getFullYear();
	const ay = a.y === null ? baseYear : a.y;
	const by = b.y === null ? (b.mo < a.mo ? ay + 1 : ay) : b.y;
	const startTs = new Date(ay, a.mo - 1, a.d, a.h, a.mi).getTime();
	const endTs = new Date(by, b.mo - 1, b.d, b.h, b.mi).getTime();
	if (!(endTs > startTs)) return null;
	return { startTs, endTs };
}

/**
 * lastData 的 games → 提醒条目（对应 core 的 `remindItemsOf`）。
 * 每个游戏侧最多两条：结束（T=endTs）/ 开始（T=startTs）；已经过去的方向不派生。
 */
export function remindItemsOf(games, now) {
	const nowTs = Number(now);
	const out = [];
	if (!Number.isFinite(nowTs) || !games || typeof games !== "object") return out;
	for (const [gameId, game] of Object.entries(games)) {
		if (!game || typeof game !== "object") continue;
		const gameName = String(game.name || gameId);
		for (const s of REMIND_SIDES) {
			const raw = String(game[s.dateKey] || "").trim();
			if (!raw) continue;
			const win = remindWindowOf(raw, nowTs);
			if (!win) continue;
			const base = {
				gameId,
				gameName,
				side: s.side,
				sideLabel: s.label,
				title: String(game[s.titleKey] || "").trim() || gameName,
				startTs: win.startTs,
				endTs: win.endTs
			};
			if (win.endTs > nowTs) out.push({ ...base, kind: "end", T: win.endTs, key: `${gameId}|${s.side}|end|${win.endTs}` });
			if (win.startTs > nowTs) out.push({ ...base, kind: "start", T: win.startTs, key: `${gameId}|${s.side}|start|${win.startTs}` });
		}
	}
	return out;
}

/**
 * 一轮判定（对应 core 的 `remindTickOf`）：**纯函数**，同样入参 ⇒ 同样结果。
 *
 * 规则（与 DSH 一致）：
 *   ① 先清状态：键里的 T 已过 ⇒ 记录作废；
 *   ② 任一条目，若有未发过的档位满足 `now >= T - n 小时` 即为"到期"；
 *   ③ **同一轮里折叠**：只发最紧急（n 最小）的那一档，其余到期档一并标已发；
 *      于是"错过补跑"时用户只会收到一条，而不是一次弹好几条；
 *   ④ T 已过 / 脏数据 ⇒ 整条作废，不发也不留键。
 *
 * @returns {{toNotify: Array<object>, stateNext: Record<string,{fired:number[]}>}}
 */
export function remindTickOf(now, items, config, state) {
	const nowTs = Number(now);
	if (!Number.isFinite(nowTs)) throw new TypeError("remindTickOf: now 必须是有限毫秒时间戳");
	const cfg = remindConfigOf(config);
	const prev = remindStateOf(state);
	const next = {};
	const toNotify = [];

	for (const [key, rec] of Object.entries(prev)) {
		const T = remindTimeOfKey(key);
		if (!Number.isFinite(T) || T <= nowTs) continue;
		next[key] = { fired: [...rec.fired] };
	}

	const seen = new Set();
	for (const rawItem of Array.isArray(items) ? items : []) {
		if (!rawItem || typeof rawItem !== "object") continue;
		const key = remindKeyOf(rawItem);
		if (seen.has(key)) continue;
		seen.add(key);
		const kind = rawItem.kind === "start" ? "start" : "end";
		const T = Number(rawItem.T);
		if (!Number.isFinite(T) || T <= nowTs) {
			delete next[key];
			continue;
		}
		const nodes = kind === "start" ? cfg.startNodes : cfg.endNodes;
		const firedPrev = new Set(next[key] ? next[key].fired : []);
		const due = [];
		for (const n of nodes) {
			if (firedPrev.has(n)) continue;
			if (nowTs >= T - n * HOUR_MS) due.push(n);
		}
		if (!due.length) continue;
		due.sort((a, b) => a - b); // 最小 = 最紧急
		next[key] = { fired: [...new Set([...firedPrev, ...due])].sort((a, b) => b - a) };
		toNotify.push({
			key,
			gameId: rawItem.gameId,
			gameName: rawItem.gameName || rawItem.gameId,
			side: rawItem.side,
			sideLabel: rawItem.sideLabel || rawItem.side,
			kind,
			title: rawItem.title || rawItem.gameName || rawItem.gameId,
			T,
			node: due[0],
			dueAt: T - due[0] * HOUR_MS,
			nodesMarked: [...due],
			startTs: rawItem.startTs,
			endTs: rawItem.endTs
		});
	}
	toNotify.sort((a, b) => a.T - b.T); // 最紧迫的在前
	return { toNotify, stateNext: next };
}

/**
 * 通知文案（对应 core 的 `remindToastOf`，逐字一致）：
 *   title: `即将结束 · 原神`
 *   lines: [`卡池「「虚星临渡」107期角色活动祈愿」`, `10-13 18:00 → 11-03 14:59 结束`, `还剩 2 天 3 小时（24 小时提醒）`]
 * 浏览器里把 lines 用换行拼成 message（chrome.notifications 只有单段正文）。
 */
export function remindToastOf(notify, now, appName) {
	const n = notify || {};
	const fallbackName = typeof appName === "string" && appName.trim() !== "" ? appName.trim() : NOTIFY_NAME_DEFAULT;
	const gameName = String(n.gameName || n.gameId || fallbackName);
	const title = (n.kind === "start" ? "即将开始 · " : "即将结束 · ") + gameName;
	const head = String(n.sideLabel || "") + "「" + String(n.title || gameName) + "」";
	const span = remindSpanText(Number(n.T) - Number(now));
	const node = remindNodeText(n.node);
	const lines = [head];
	if (n.kind === "start") {
		lines.push(remindClockOf(n.startTs) + " 开始 → " + remindClockOf(n.endTs) + " 结束");
		lines.push("还有 " + span + "（" + (node ? node + "提醒" : "到点提醒") + "）");
	} else {
		lines.push(remindClockOf(n.startTs) + " → " + remindClockOf(n.endTs) + " 结束");
		lines.push("还剩 " + span + "（" + (node ? node + "提醒" : "到点提醒") + "）");
	}
	return { title, lines };
}

/**
 * 测试通知文案（对应 core 的 `remindTestToastOf`）：
 * 与真实提醒**完全隔离** —— 不读也不改去重状态，只回答"通知到底能不能弹"。
 * 时间按本机时区精确到秒（用户点完立刻对表）。
 */
export function remindTestToastOf(now, appName) {
	const app = typeof appName === "string" && appName.trim() !== "" ? appName.trim() : NOTIFY_NAME_DEFAULT;
	const d = new Date(Number(now));
	const clock = Number.isFinite(d.getTime())
		? d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds())
		: "";
	return {
		title: app + " · 通知测试",
		lines: ["发送者：" + app, "通道：系统通知（浏览器）", "时间：" + clock, "看到这条说明系统通知链路是通的"]
	};
}
