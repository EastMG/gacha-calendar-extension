// gacha-calendar-extension · background service worker（MV3）
//
// 职责只有一件：**代扩展的其他页面发跨域请求**。
//
// 为什么必须放在这里：扩展的内容脚本 / popup 仍然受页面同源策略约束，抓取 40+ 个来源里
// 只有 6 个带 CORS 放行头；其余（canmoe / fz.wiki / 万美 / game8 / ldshop / 1999 /
// 蔚蓝国服 / Nexon / GameKee / 小米 / wiki.gg）都会因为没有 ACAO 而被浏览器拦掉。
// 而 background service worker 凭 manifest 的 host_permissions 可以真正跨域，
// 并且能自行设置 Referer / Origin —— 这两点正是抓这些站所必需的。
//
// 安全红线：**必须保留主机白名单**。没有它，本 worker 就是一个
// "任意内网地址请求器"（SSRF）；而且必须校验消息来源（sender），
// 否则任何网页都能通过消息桥驱使扩展去请求任意地址。

/** 允许代发的主机白名单（与 manifest.host_permissions 同源，精确或子域匹配）。 */
import {
	NOTIFY_NAME_DEFAULT,
	REMIND_DEFAULT_END_NODES,
	remindItemsOf,
	remindTickOf,
	remindToastOf,
	remindTestToastOf
} from "./remind.js";

const ALLOW_HOSTS = [
	"ak.hypergryph.com",
	"aki-gm-resources-back.aki-game.com",
	"aki-gm-resources.aki-game.com",
	"api-takumi-static.mihoyo.com",
	"api-web.bluearchive.jp",
	"api.biligame.com",
	"api.fz.wiki",
	"api.umapyoi.net",
	"bang-dream-on.bushimo.jp",
	"bbs-api.miyoushe.com",
	"bestdori.com",
	"bluearchive-cn.com",
	"bluearchive.jp",
	"end.canmoe.com",
	"endfield.wiki.gg",
	"fgo.wiki",
	"forum.nexon.com",
	"fz.wiki",
	"gachatracker.app",
	"game.bilibili.com",
	"game.xiaomi.com",
	"game8.co",
	"gametora.com",
	"gf2-web-preregister-api.sunborngame.com",
	"gf2.sunborngame.com",
	"gh-proxy.com",
	"l11-web-api.biligames.com",
	"notice.sl916.com",
	"p5x.wanmei.com",
	"prts.wiki",
	"raw.githubusercontent.com",
	"re.bluepoch.com",
	"sekai-world.github.io",
	"stellasora.yostar.cn",
	"umamusume.com",
	"umamusume.jp",
	"web-news.hypergryph.com",
	"wiki.biligame.com",
	"www.biligame.com",
	"www.biligames.com",
	"gamekee.com",
	"www.ldshop.gg",
	"www.miyoushe.com",
	"www.sl916.com",
	"yh.wanmei.com",
	"zzz.mihoyo.com"
];

/** 与 DSH 宿主代理一致的浏览器 UA（部分站按 UA 做反爬判定）。 */
const UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** 请求超时（与 DSH 宿主代理的 15s 保持一致）。 */
const TIMEOUT_MS = 15000;

function hostAllowed(hostname) {
	return ALLOW_HOSTS.some((allow) => hostname === allow || hostname.endsWith("." + allow));
}

/**
 * 消息来源校验：只接受本扩展自己的页面（popup / options / 扩展页）。
 * 其他网页/内容脚本一律拒绝。
 *
 * ⚠️ 不能只看 `sender.tab === undefined`（2026-10-30 真机踩到）：
 *    设置页是用 `chrome.runtime.openOptionsPage()` 开在**标签页**里的，此时 `sender.tab` 是有的，
 *    旧实现会把设置页自己发的消息判成 untrusted —— 「发送测试通知」直接回 `untrusted-sender`，
 *    （同理，设置页的解析器自检走 proxyFetch 也会被拒）。
 *    正确判据是**发送者 URL 属于本扩展**：`chrome-extension://<本扩展 id>/…`。
 *    扩展没有 content script，网页里的消息 `sender.id` 为空 / URL 不是扩展源，仍会被拒。
 */
function trustedSender(sender) {
	if (!sender) return false;
	if (sender.id !== chrome.runtime.id) return false;
	const url = typeof sender.url === "string" ? sender.url : "";
	if (url.startsWith(`chrome-extension://${chrome.runtime.id}/`)) return true;
	// 极少见：没有 url 的扩展内部调用（无 tab 时）也放行；带 tab 但没有扩展 URL 的一律拒
	return url === "" && sender.tab === undefined;
}

/**
 * 代发一次请求。
 * 契约（对应 core 的 transport.fetchViaProxy）：
 *   入参 { url, referer?, headers?, body? }
 *   出参 目标站【原始 body 字符串】；失败时 throw（core 会归一成"网络不通/超时/HTTP xxx"）
 * 注意：body 允许为空串（"")，此时按 GET 处理；有 body 时以 POST + JSON 发出。
 */
async function proxyFetch(msg) {
	let target;
	try {
		target = new URL(msg.url);
	} catch {
		throw new Error("bad-url");
	}
	if (target.protocol !== "https:") throw new Error("bad-protocol");
	if (!hostAllowed(target.hostname)) throw new Error("host-not-allowed:" + target.hostname);

	const headers = {
		"User-Agent": UA,
		Accept: "application/json, text/plain, */*",
		Referer: msg.referer || target.origin + "/",
		Origin: target.origin
	};
	// 额外请求头（如 GameKee 需要 game-alias）
	if (msg.headers && typeof msg.headers === "object") {
		for (const [k, v] of Object.entries(msg.headers)) {
			if (typeof v === "string" || typeof v === "number") headers[k] = String(v);
		}
	}

	const init = { headers, redirect: "follow" };
	if (typeof msg.body === "string" && msg.body !== "") {
		init.method = "POST";
		headers["Content-Type"] = "application/json; charset=utf-8";
		init.body = msg.body;
	}

	const ac = new AbortController();
	const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
	try {
		const res = await fetch(target.href, { ...init, signal: ac.signal });
		const text = await res.text();
		if (!res.ok) throw new Error("http-" + res.status);
		return text;
	} finally {
		clearTimeout(timer);
	}
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
	if (!trustedSender(sender)) {
		sendResponse({ ok: false, error: "untrusted-sender" });
		return false;
	}
	// 「发送测试通知」：设置页按钮 → 这里生成 DSH 同款文案并弹一条，用完即弃（不读写去重状态）
	if (msg && msg.type === "testNotify") {
		(async () => {
			const store = await chrome.storage.local.get("notifyName");
			const now = Date.now();
			const toast = remindTestToastOf(now, store.notifyName);
			await chrome.notifications.create(`gc:test:${now}`, {
				type: "basic",
				iconUrl: "icons/icon-128.png",
				title: toast.title,
				message: toast.lines.join("\n"),
				priority: 2
			});
			sendResponse({ ok: true, title: toast.title, lines: toast.lines });
		})().catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
		return true;
	}
	if (!msg || msg.type !== "proxyFetch") {
		sendResponse({ ok: false, error: "unknown-message" });
		return false;
	}
	proxyFetch(msg)
		.then((body) => sendResponse({ ok: true, body }))
		.catch((err) => {
			// 归一成 core 认得的短原因（见 core 的 normErr）：
			// 超时 → AbortError；HTTP 非 2xx → "http-<code>"；其余原样传出
			const name = (err && err.name) || "";
			const message = name === "AbortError" || /abort/i.test(String(err && err.message))
				? "timeout"
				: String((err && err.message) || err);
			sendResponse({ ok: false, error: message });
		});
	// 异步响应：保持消息通道打开
	return true;
});

// —— 实验特性「新日程面板」的入口切换 ——
//
// 新面板已改造为可在 popup 内使用：固定 520×600（浏览器上限 800×600），内容在面板内部滚动、
// 底栏常驻。开启时把工具栏 popup 指向 popup-panel.html；关闭时恢复原 popup.html，
// 行为与之前完全一致。**没有独立页面分支** —— 面板只有 popup 一种宿主。
const PANEL_POPUP = "popup-panel.html";

async function syncActionPopup() {
	try {
		const { newPanel } = await chrome.storage.local.get("newPanel");
		// 默认开启：只有显式存了 false 才回落到原 popup
		await chrome.action.setPopup({ popup: newPanel === false ? "popup.html" : PANEL_POPUP });
	} catch {
		/* 设置读取失败时保持 manifest 里的默认 popup */
	}
}

chrome.runtime.onInstalled.addListener(syncActionPopup);
chrome.runtime.onStartup.addListener(syncActionPopup);
chrome.storage.onChanged.addListener((changes, area) => {
	if (area === "local" && changes.newPanel) syncActionPopup();
	if (area === "local" && (changes.lastData || changes.badge)) updateBadge();
	// 新数据到位 / 用户刚打开开关时，立刻按最新数据判一轮（不等 30 分钟）
	if (area === "local" && (changes.lastData || changes.notify)) checkReminders();
});
// 仅在 popup 被置空时触发（即新面板开启时）
syncActionPopup();

// —— 到期角标 ——
//
// 在工具栏图标上显示「3 天内到期的条目数」。**只读本地缓存**（lastData），不联网、不请求新数据。
//
// 为什么放在 background：角标要能**定时刷新**。MV3 的 service worker 会被休眠，
// 用 chrome.alarms 每 30 分钟唤醒一次重算（alarms 是唯一能在 SW 休眠后唤醒它的机制）。
//
// ⚠️ 能力边界（不要对用户承诺做不到的事）：
//   · 浏览器**没开**时不会有任何更新 —— 扩展没有常驻进程；
//   · 扩展**不能**让浏览器开机自启；`chrome.runtime.onStartup` 只在浏览器启动时触发；
//   · 浏览器窗口关闭后是否继续跑，取决于用户自己的「关闭后继续运行后台应用」设置。
//
// 数据口径：lastData 是 JSON 字符串，形如 `{ [游戏id]: { bannerDates, eventDates, … } }`，
// 其中 bannerDates/eventDates 是**本机时区换算后的**「MM-DD HH:MM ~ MM-DD HH:MM」外显文本，
// 所以这里按本机时区解析，和面板显示一致。
const BADGE_ALARM = "gacha-calendar-badge";
const BADGE_DAYS = 3;

/** 解析「MM-DD HH:MM ~ MM-DD HH:MM」→ { startTs, endTs }；失败返回 null。 */
function parseBadgeRange(str, nowMs) {
	if (typeof str !== "string") return null;
	const parts = str.split(/~/).map((x) => x.trim());
	if (parts.length < 2) return null;
	const parsePart = (p) => {
		const m = p.match(/^(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?$/);
		if (!m) return null;
		const mo = Number(m[1]);
		const d = Number(m[2]);
		if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
		const h = m[3] ? Number(m[3]) : 0;
		const mi = m[4] ? Number(m[4]) : 0;
		const base = new Date(new Date(nowMs).getFullYear(), mo - 1, d, h, mi).getTime();
		return { mo, base };
	};
	const a = parsePart(parts[0]);
	const b = parsePart(parts[1]);
	if (!a || !b) return null;
	let endTs = b.base;
	if (b.mo < a.mo) endTs += 365 * 24 * 60 * 60 * 1000; // 跨年
	return { startTs: a.base, endTs };
}

async function updateBadge() {
	try {
		const { lastData, badge } = await chrome.storage.local.get(["lastData", "badge"]);
		// 默认开启；只有显式存了 false 才不显示
		if (badge === false) {
			await chrome.action.setBadgeText({ text: "" });
			return;
		}
		const now = Date.now();
		const limit = now + BADGE_DAYS * 24 * 60 * 60 * 1000;
		let count = 0;
		let map = {};
		try {
			map = lastData ? JSON.parse(lastData) : {};
		} catch {
			map = {};
		}
		for (const rec of Object.values(map || {})) {
			if (!rec || typeof rec !== "object") continue;
			for (const field of ["bannerDates", "eventDates"]) {
				const r = parseBadgeRange(rec[field], now);
				// 只数"还没结束、且 3 天内到期"的
				if (r && r.endTs > now && r.endTs <= limit) count++;
			}
		}
		await chrome.action.setBadgeBackgroundColor({ color: "#E0A93B" });
		await chrome.action.setBadgeText({ text: count > 0 ? (count > 9 ? "9+" : String(count)) : "" });
	} catch {
		/* 角标失败不影响任何主流程 */
	}
}

// —— 到期通知（口径一比一照抄 DSH 版）——
//
// 与角标共用同一个 30 分钟 alarm。真正的判定逻辑在 src/remind.js（纯函数移植，见那里的注释）：
//   · 档位 = 结束后 72 / 24 / 6 / 2 小时（设置页胶囊，可全点掉 = 不提醒）
//   · 同一轮内**折叠**：几条档位同时到期时只发最紧急的那一档，其余标已发 ⇒ 补跑不会连环弹
//   · 文案与 DSH 一致：标题「即将结束 · 原神」，正文「卡池「…」/ 起止时间 / 还剩 2 天 3 小时（24 小时提醒）」
//   · 去重状态存 `remindState`：{ "id|side|end|T": { fired: [72, 24] } }，T 过期即清
//
// ⚠️ 送达受浏览器生命周期限制：浏览器没运行（含后台进程被关掉）时不会提醒。
//    用户若开了 Edge 的「随系统启动 + 关闭后继续运行后台扩展」，覆盖时间就很完整。
const REMIND_STATE_KEY = "remindState";

async function checkReminders() {
	try {
		const store = await chrome.storage.local.get(["lastData", "remindOn", "remindEndNodes", "notifyName", REMIND_STATE_KEY, "notify"]);
		// 默认开（与 DSH 的 remindOn 默认一致）；兼容 0.2.33 的旧键 notify（那版默认关）
		const on = typeof store.remindOn === "boolean" ? store.remindOn : store.notify === false ? false : true;
		if (!on) return;
		let map = {};
		try {
			map = store.lastData ? JSON.parse(store.lastData) : {};
		} catch {
			map = {};
		}
		const now = Date.now();
		const items = remindItemsOf(map, now);
		const { toNotify, stateNext } = remindTickOf(now, items, { remindEndNodes: store.remindEndNodes }, store[REMIND_STATE_KEY]);
		for (const n of toNotify) {
			const toast = remindToastOf(n, now, store.notifyName);
			try {
				await chrome.notifications.create(`gc:${n.key}:${n.node}`, {
					type: "basic",
					iconUrl: "icons/icon-128.png",
					title: toast.title,
					message: toast.lines.join("\n"),
					priority: 2
				});
			} catch {
				/* 单条失败不影响其余 */
			}
		}
		await chrome.storage.local.set({ [REMIND_STATE_KEY]: stateNext });
	} catch {
		/* 提醒失败不影响任何主流程 */
	}
}

chrome.notifications.onClicked.addListener((nid) => {
	chrome.notifications.clear(nid);
});

chrome.alarms.create(BADGE_ALARM, { periodInMinutes: 30 });
chrome.alarms.onAlarm.addListener((alarm) => {
	if (alarm && alarm.name === BADGE_ALARM) {
		updateBadge();
		checkReminders();
	}
});
chrome.runtime.onInstalled.addListener(() => {
	updateBadge();
	checkReminders();
});
chrome.runtime.onStartup.addListener(() => {
	updateBadge();
	checkReminders();
});
// SW 每次被唤醒（例如用户点图标）也顺手算一次，避免等满 30 分钟
updateBadge();
checkReminders();
