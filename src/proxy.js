// 代发跨域请求的公共实现（background SW 与后台刷新 worker 共用）。
//
// 为什么单独成文件：background.js 是**原样复制**进 dist 的（保持可读、便于商店审查），
// 而后台刷新 worker 要走 esbuild 打包（内联 core）。两者都需要同一份白名单与 fetch 逻辑，
// 抽到这里以后只有一处实现，避免"改了白名单只改了一半"。
//
// 安全红线：**必须保留主机白名单**。没有它，本 worker 就是一个
// "任意内网地址请求器"（SSRF）；调用方还必须校验消息来源。

/** 允许代发的主机白名单（与 manifest.host_permissions 同源，精确或子域匹配）。 */
export const ALLOW_HOSTS = [
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

export function hostAllowed(hostname) {
	return ALLOW_HOSTS.some((allow) => hostname === allow || hostname.endsWith("." + allow));
}

/**
 * 代发一次请求。
 * 契约（对应 core 的 transport.fetchViaProxy）：
 *   入参 { url, referer?, headers?, body? }
 *   出参 目标站【原始 body 字符串】；失败时 throw（core 会归一成"网络不通/超时/HTTP xxx"）
 * 注意：body 允许为空串（"")，此时按 GET 处理；有 body 时以 POST + JSON 发出。
 */
export async function proxyFetch(msg) {
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
