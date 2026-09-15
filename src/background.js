// gacha-calendar-extension · background service worker（MV3）
//
// 职责只有一件：**代扩展的其他页面发跨域请求**。
//
// 为什么必须放在这里：扩展的内容脚本 / popup 仍然受页面同源策略约束，抓取 25 个来源里
// 只有 6 个带 CORS 放行头；其余（canmoe / fz.wiki / 万美 / game8 / ldshop / 1999 /
// 蔚蓝国服 / Nexon / GameKee / 小米 / wiki.gg）都会因为没有 ACAO 而被浏览器拦掉。
// 而 background service worker 凭 manifest 的 host_permissions 可以真正跨域，
// 并且能自行设置 Referer / Origin —— 这两点正是抓这些站所必需的。
//
// 安全红线（交接文档 §8）：**必须保留主机白名单**。没有它，本 worker 就是一个
// "任意内网地址请求器"（SSRF）；而且必须校验消息来源（sender），
// 否则任何网页都能通过消息桥驱使扩展去请求任意地址。

/** 允许代发的主机白名单（与 manifest.host_permissions 同源，精确或子域匹配）。 */
const ALLOW_HOSTS = [
	// 官方 / 官方 API
	"api-takumi-static.mihoyo.com",
	"aki-gm-resources-back.aki-game.com",
	"aki-gm-resources-back-huoshan.aki-game.com",
	"aki-gm-resources.aki-game.com",
	"web-news.hypergryph.com",
	"ak.hypergryph.com",
	"yh.wanmei.com",
	"bluearchive-cn.com",
	"api-web.bluearchive.jp",
	// 仅作为 Referer/Origin 使用的站点（某些源会校验来源域）
	"bluearchive.jp",
	"zzz.mihoyo.com",
	"re.bluepoch.com",
	"game.xiaomi.com",
	"forum.nexon.com",
	// 社区 Wiki / 数据站
	"wiki.biligame.com",
	"prts.wiki",
	"end.canmoe.com",
	"fz.wiki",
	"endfield.wiki.gg",
	"gachatracker.app",
	"game8.co",
	"www.ldshop.gg",
	"www.gamekee.com",
	"api-cdn.gamekee.com"
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
 */
function trustedSender(sender) {
	if (!sender) return false;
	if (sender.id !== chrome.runtime.id) return false;
	// 扩展自己的页面没有 tab；有 tab 的一律不信任（本扩展不注册任何内容脚本）
	return sender.tab === undefined;
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
