// 后台抓取 worker：把 core 引擎**跑在 service worker 里**（构建时内联 gacha-calendar-core）。
//
// 为什么需要它（2026-10-30 用户决策）：到期提醒/角标读的是本地 `lastData`，
// 如果只有"打开面板才抓"，用户不开面板数据就会一直停在旧的一轮 → 提醒算错、甚至漏发。
// 所以「浏览器启动时抓一轮」必须发生在**后台**，不能依赖页面打开。
//
// 职责边界：
//   · 本文件只做"抓 + 写缓存"和"什么时候该抓"的调度；
//   · 通知/角标仍由 background.js 负责 —— 抓完通过 setRefreshListener 回调过去，
//     让它们基于**新数据**重算（而不是等下一次 30 分钟闹钟）。
//
// SW 生命周期：MV3 的 SW 会被休眠；这里靠 chrome.alarms 唤醒（与角标/提醒同一个机制）。
// 抓取期间 SW 有网络活动，Chrome 不会在 fetch 进行中回收它；即便被回收，
// core 只会在最后一刻才写 lastData/lastRefresh，下一次闹钟会补一轮。
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

/** core 需要的 transport：直连 + 走本文件的 host 白名单代发。 */
const transport = {
	fetchRaw: (url, opts) => fetch(url, opts),
	fetchViaProxy: (url, opts = {}) =>
		proxyFetch({ url, referer: opts.referer, headers: opts.headers, body: opts.body })
};

const engine = createEngine({ transport, storage });

/** 抓完之后的回调（background 注册：重算角标 + 通知）。 */
let onRefreshed = null;
export function setRefreshListener(fn) {
	onRefreshed = typeof fn === "function" ? fn : null;
}

/** 同一时间只允许一轮（页面刷新与后台刷新撞车时共用同一个 Promise）。 */
let inFlight = null;

/** 立刻抓一轮；返回 core 的 refresh() 结果。失败只记录、不抛出（SW 里抛也没人接）。 */
export function refreshNow(reason = "manual") {
	if (inFlight) return inFlight;
	inFlight = engine
		.refresh()
		.then((result) => {
			try {
				onRefreshed && onRefreshed(reason);
			} catch {
				/* 回调失败不影响抓取结果 */
			}
			return result;
		})
		.catch((err) => {
			console.warn("[gacha] 后台刷新失败：", String((err && err.message) || err));
			return null;
		})
		.finally(() => {
			inFlight = null;
		});
	return inFlight;
}

const REFRESH_ALARM = "gacha-background-refresh";
/** 「启动时」模式下的兜底：数据超过这个时长就在提醒巡检时补抓一轮（免得提醒用隔夜数据）。 */
const STALE_MS = 24 * 60 * 60 * 1000;

async function readCfg() {
	const keys = ["autoRefresh", "refreshMode", "refreshMinutes", "lastRefresh"];
	const obj = await chrome.storage.local.get(keys);
	return obj || {};
}

/** 按设置同步「间隔刷新」的闹钟（启动时模式不需要周期性闹钟）。 */
async function syncSchedule() {
	const cfg = await readCfg();
	const on = cfg.autoRefresh !== false;
	const mode = cfg.refreshMode === "interval" ? "interval" : "startup";
	const minutes = Math.max(1, Number(cfg.refreshMinutes) || 24 * 60);
	await chrome.alarms.clear(REFRESH_ALARM);
	if (on && mode === "interval") {
		chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: minutes });
	}
}

/** 浏览器启动 / 安装 / 更新：抓一轮（这是"启动即抓"的本体）。 */
async function refreshOnLaunch() {
	const cfg = await readCfg();
	if (cfg.autoRefresh === false) return;
	await refreshNow("startup");
}

/** 提醒巡检时调用：「启动时」模式下数据太旧就补抓一轮。 */
export async function maybeRefreshIfStale() {
	const cfg = await readCfg();
	if (cfg.autoRefresh === false) return;
	const mode = cfg.refreshMode === "interval" ? "interval" : "startup";
	if (mode !== "startup") return; // interval 模式由闹钟负责
	const last = Number(cfg.lastRefresh) || 0;
	if (Date.now() - last >= STALE_MS) await refreshNow("stale");
}

chrome.runtime.onStartup.addListener(() => {
	refreshOnLaunch();
	syncSchedule();
});
chrome.runtime.onInstalled.addListener(() => {
	refreshOnLaunch();
	syncSchedule();
});
chrome.alarms.onAlarm.addListener((alarm) => {
	if (alarm && alarm.name === REFRESH_ALARM) refreshNow("interval");
});
// 设置改动（开关 / 档位 / 间隔）立即生效，不用等下次启动
chrome.storage.onChanged.addListener((changes, area) => {
	if (area !== "local") return;
	if (changes.autoRefresh || changes.refreshMode || changes.refreshMinutes) syncSchedule();
});

// SW 每次被唤醒都对齐一次闹钟（防止扩展更新后旧闹钟残留）
syncSchedule();
