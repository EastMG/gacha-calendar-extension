// transport 适配层：实现 core 需要的两个方法（契约见 gacha-calendar-core 的 README）。
//
//   fetchRaw(url, opts)  → WHATWG Response 形态（ok / status / text() / json()）
//                          用于 CORS 放行的源：bwiki、PRTS、绝区零公告、鸣潮公告、
//                          蔚蓝日服、GachaTracker —— 这些站回 access-control-allow-origin。
//   fetchViaProxy(url, { referer, headers, body }) → 目标站【原始 body 字符串】
//                          用于没有 ACAO 的源：转给 background service worker 代发
//                          （它凭 host_permissions 真正跨域，且能设 Referer/Origin）。
//
// ⚠️ 这是最容易踩的坑：fetchViaProxy 必须返回**字符串**，不是 { status, body } 对象。
// 返回错形状不会报"契约错误"，只会让每一款游戏都静默变成"抓取异常"，很难定位。

/**
 * 与 background 通信：代发一次跨域请求，拿回目标站原始 body 字符串。
 * 失败时抛出的错误消息刻意做成 core 的 normErr 能识别的形状：
 *   "timeout"            → 超时
 *   "http-403"           → HTTP 403
 *   "host-not-allowed:x" → 无可用来源（属于配置错误，不该发生）
 */
export async function fetchViaProxy(url, { referer, headers, body } = {}) {
	let res;
	try {
		res = await chrome.runtime.sendMessage({
			type: "proxyFetch",
			url,
			referer,
			headers,
			// 只在确实是"有 body"时传字符串；空串表示 GET（background 按此判定）
			body: body === undefined || body === null ? undefined : typeof body === "string" ? body : JSON.stringify(body)
		});
	} catch (err) {
		// Service worker 尚未启动 / 扩展被重载时的通道错误
		throw new Error("背景页通信失败：" + String((err && err.message) || err));
	}
	if (!res) throw new Error("背景页无响应");
	if (res.ok) return res.body;
	const e = String(res.error || "抓取异常");
	if (e === "timeout") throw new Error("timeout");
	if (/^http-\d{3}$/.test(e)) throw new Error(e);
	throw new Error(e);
}

/**
 * CORS 放行的源：直接用页面自身的 fetch。
 * 注意：这些 URL 由 core 自行拼好（MediaWiki 系已带 origin=*，不能丢）。
 */
export function fetchRaw(url, opts) {
	return fetch(url, opts);
}

/** 交给 createEngine 的 transport。 */
export const transport = { fetchRaw, fetchViaProxy };
