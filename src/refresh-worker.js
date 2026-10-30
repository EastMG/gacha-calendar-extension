// 后台抓取引擎（把 core 跑在 service worker 里，构建时内联 gacha-calendar-core）。
//
// 为什么需要：到期提醒/角标读的是本地 `lastData`。如果只有"打开面板才抓"，
// 用户不开面板数据就停在旧的一轮 → 提醒算错、甚至漏发。所以「浏览器启动时抓一轮」
// 必须发生在**后台**。
//
// 设计原则：**这个文件只负责"抓"，不负责"什么时候抓"**。
//   调度只有一处（background.js 的 `gacha-tick` 闹钟 + 启动/安装/设置变更），
//   避免上一版"两个闹钟各判一次、面板又判一次"导致的重复抓取。
//
// 对外只暴露两个函数：
//   · runRefreshTick()  按当前设置判断"这一轮该不该抓"，该抓就抓（幂等、可并发调用）
//   · refreshNow()      无条件抓一轮（手动/调试用）
import { createEngine } from "gacha-calendar-core";
import { proxyFetch } from "./proxy.js";

/** chrome.storage.local → core 需要的 { get, set }。 */
const storage = {
	async get(key) {
		const obj = await chrome.storage.local.get(key);
		return obj ? obj[key] : undefined;
	},
	async set(key, value) {
		// undefined 不能进 chrome.storage（会被丢掉）→ 存 null 明确表示"清空"
		await chrome.storage.local.set({ [key]: value === undefined ? null : value });
	}
};

/** core 需要的 transport：直连 + 走 proxy.js 的白名单代发。 */
const transport = {
	fetchRaw: (url, opts) => fetch(url, opts),
	fetchViaProxy: (url, opts = {}) => proxyFetch({ url, referer: opts.referer, headers: opts.headers, body: opts.body })
};

const engine = createEngine({ transport, storage });

/** 同一时间只允许一轮（多处触发撞车时共用同一个 Promise）。 */
let inFlight = null;

/** 无条件抓一轮。失败只记录、不抛出（SW 里抛也没人接）。 */
export function refreshNow() {
	if (inFlight) return inFlight;
	inFlight = engine
		.refresh()
		.catch((err) => {
			console.warn("[gacha] 后台刷新失败：", String((err && err.message) || err));
			return null;
		})
		.finally(() => {
			inFlight = null;
		});
	return inFlight;
}

/** 「启动时」模式用：本浏览器会话是否已经抓过（浏览器退出即清空）。 */
const SESSION_KEY = "sessionRefreshedAt";
/** 「启动时」模式下的兜底：数据超过这个时长就在下一次 tick 补抓（免得长期不重启用隔夜数据）。 */
const STALE_MS = 24 * 60 * 60 * 1000;

async function sessionRefreshedAt() {
	try {
		const s = await chrome.storage.session.get(SESSION_KEY);
		return Number(s && s[SESSION_KEY]) || 0;
	} catch {
		return 0; // 没有 storage.session 的浏览器：当作"没抓过"，即每次 tick 都可能抓
	}
}

async function markSessionRefreshed(ts) {
	try {
		await chrome.storage.session.set({ [SESSION_KEY]: ts });
	} catch {
		/* 没有 storage.session：不记也没关系，退化成"数据够新就不抓" */
	}
}

/**
 * 一轮判定：**唯一**的"什么时候该抓"的决策点。
 *   · autoRefresh = false            → 不抓
 *   · refreshMode = "startup"        → 本次会话还没抓过，或数据超过 24h ⇒ 抓
 *   · refreshMode = "interval"       → 距上次成功超过 refreshMinutes ⇒ 抓
 * @returns {Promise<boolean>} 这一轮是否真的抓了
 */
export async function runRefreshTick() {
	const cfg = await chrome.storage.local.get(["autoRefresh", "refreshMode", "refreshMinutes", "lastRefresh"]);
	if (cfg.autoRefresh === false) return false;

	const last = Number(cfg.lastRefresh) || 0;
	const now = Date.now();
	const mode = cfg.refreshMode === "interval" ? "interval" : "startup";

	let due;
	if (mode === "startup") {
		const sessionAt = await sessionRefreshedAt();
		due = !sessionAt || now - last >= STALE_MS;
	} else {
		const minutes = Math.max(1, Number(cfg.refreshMinutes) || 24 * 60);
		due = !last || now - last >= minutes * 60 * 1000;
	}
	if (!due) return false;

	await refreshNow();
	await markSessionRefreshed(now);
	return true;
}
