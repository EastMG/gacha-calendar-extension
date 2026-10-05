// 生成"离线渲染夹具"与商店素材。
//
// 为什么需要离线夹具：
//   面板/设置页截图是"扩展能渲染"的证据。真实扩展里截图要靠 CDP，而 CDP 在本机不通；
//   Playwright 又禁止 file://。所以改成：**在 Node 里用真网络跑一轮 core 拿到真实缓存** →
//   把缓存灌进一个 chrome.* 桩 → 用真实浏览器渲染 dist/ 的构建产物 → 截图。
//   截的仍是**构建产物本身**，只是数据来自离线种子，因此不需要浏览器内跨域。
//
// 产出：
//   _lab/popup.html              面板（README 用的整幅截图）
//   _lab/panel-1280x800.html     面板 + 品牌区（商店截图用，1280×800）
//   _lab/options.html            设置页（带桩，商店截图用）
//   store/assets/logo-300.png    商店徽标 300×300（与扩展图标同一份绘制代码）
//
// 用法：node tools/make-store-assets.mjs
//      再用 tools/serve-shot.mjs 起临时服务，浏览器打开 _lab/*.html 截图。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { drawIcon, encodePng } from "./icon-art.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const LAB = path.join(ROOT, "_lab");
const STORE_ASSETS = path.join(ROOT, "store", "assets");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/** 与 src/transport.js 契约一致的 Node transport（Node 无 CORS 限制，直接发）。 */
function makeTransport() {
	return {
		async fetchRaw(url, opts) {
			return fetch(url, opts);
		},
		async fetchViaProxy(url, { referer, headers, body } = {}) {
			const target = new URL(url);
			const h = {
				"User-Agent": UA,
				Accept: "application/json, text/plain, */*",
				Referer: referer || target.origin + "/",
				Origin: target.origin,
				...(headers || {})
			};
			const init = { headers: h, redirect: "follow" };
			if (typeof body === "string" && body !== "") {
				init.method = "POST";
				h["Content-Type"] = "application/json; charset=utf-8";
				init.body = body;
			}
			const res = await fetch(url, init);
			const text = await res.text();
			if (!res.ok) throw new Error("http-" + res.status);
			return text;
		}
	};
}

if (!fs.existsSync(path.join(DIST, "popup.js"))) {
	console.error("✗ 先跑 node build.mjs（需要 dist/）");
	process.exit(1);
}

// ---------- 1. 真抓一轮，拿到真实缓存 ----------
const corePkgPath = path.join(ROOT, "node_modules", "gacha-calendar-core", "package.json");
const corePkg = JSON.parse(fs.readFileSync(corePkgPath, "utf8"));
const { createEngine } = await import(pathToFileURL(path.join(path.dirname(corePkgPath), corePkg.main)).href);

const mem = new Map();
const engine = createEngine({
	transport: makeTransport(),
	storage: {
		async get(k) {
			return mem.get(k);
		},
		async set(k, v) {
			mem.set(k, v);
		}
	}
});

console.log(`core ${corePkg.version}：真网络抓一轮…`);
const result = await engine.refresh();
const ids = Object.keys(result.games);
const has = (v) => typeof v === "string" && v.length > 0;
const gachaOk = ids.filter((i) => has(result.games[i].banner)).length;
const eventOk = ids.filter((i) => has(result.games[i].event)).length;
console.log(`  卡池 ${gachaOk}/${ids.length}，活动 ${eventOk}/${ids.length}`);

const { buildScrapeInfo } = await import(pathToFileURL(path.join(ROOT, "src", "view-helpers.js")).href);
const games = await engine.listGames();
const hiddenIds = engine.__test.SOURCES.filter((s) => s.defaultHidden).map((s) => s.id);
const visible = games.filter((g) => !hiddenIds.includes(g.id));
const info = buildScrapeInfo(visible.map((g) => ({ id: g.id, name: g.name })), result);

const seed = {
	// 关掉自动抓取：截图用缓存即可，打开时不要联网
	autoRefresh: false,
	refreshMinutes: 24 * 60,
	lastSource: "web",
	lastRefresh: Date.now(),
	lastData: mem.get("lastData"),
	hidden: [],
	shown: [],
	order: []
};

// ---------- 2. 生成夹具 ----------
fs.rmSync(LAB, { recursive: true, force: true });
fs.mkdirSync(LAB, { recursive: true });
for (const f of ["popup.js", "popup.css", "options.js", "options.css", "core-version.js"]) {
	fs.copyFileSync(path.join(DIST, f), path.join(LAB, f));
}

// 为什么也要复制 core-version.js：设置页是**运行时动态 import** 它（故意不内联进 bundle，
// 见 src/options.js 的 `await import("./core-version.js")`）。夹具里缺了它，
// "关于"卡片会显示「抓取核心 —」而不是真实版本号（截图会失真）。
fs.writeFileSync(path.join(LAB, "core-version.js"), fs.readFileSync(path.join(DIST, "core-version.js")));

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));

/**
 * chrome.* 桩：让构建产物在普通页面里也能跑。
 * 用真实 manifest 填充 getManifest()，这样设置页的主机候选列表与真机一致。
 */
function chromeStub(extra = {}) {
	return `<script>
window.__SEED__ = ${JSON.stringify({ ...seed, ...extra })};
window.__MANIFEST__ = ${JSON.stringify(manifest)};
(() => {
  const store = { ...window.__SEED__ };
  window.__STORE__ = store;
  window.chrome = {
    runtime: {
      id: "storelab",
      getManifest: () => window.__MANIFEST__,
      openOptionsPage() {},
      sendMessage: async () => { throw new Error("offline-fixture"); }
    },
    storage: { local: {
      get: async (keys) => {
        if (keys === null || keys === undefined) return { ...window.__STORE__ };
        if (typeof keys === "string") return (keys in window.__STORE__) ? { [keys]: window.__STORE__[keys] } : {};
        const out = {};
        for (const k of keys) if (k in window.__STORE__) out[k] = window.__STORE__[k];
        return out;
      },
      set: async (patch) => Object.assign(window.__STORE__, patch)
    }}
  };
})();
</script>`;
}

/** 把桩与额外的收尾脚本注入页面 HTML。 */
function inject(html, stub, tail = "") {
	return html.replace("</body>", stub + "\n\t\t" + tail + "\n\t</body>");
}

// —— 面板（README 用）——
const popupHtml = fs.readFileSync(path.join(ROOT, "src", "popup.html"), "utf8");
fs.writeFileSync(
	path.join(LAB, "popup.html"),
	inject(
		popupHtml,
		chromeStub(),
		`<script type="module">
// 夹具专用：把抓取结论喂给顶部提示（真实扩展由 doRefresh 设置）
setTimeout(() => { const s = document.getElementById("scrape"); if (s) { s.hidden = false; s.textContent = ${JSON.stringify(info.info)}; } }, 400);
</script>`
	),
	"utf8"
);

// —— 设置页（商店截图用）——
const optionsHtml = fs.readFileSync(path.join(ROOT, "src", "options.html"), "utf8");
fs.writeFileSync(path.join(LAB, "options.html"), inject(optionsHtml, chromeStub()), "utf8");

// —— 设置页变体：预置两个已删除条目，用来展示「已删除的条目 / 恢复」卡片 ——
fs.writeFileSync(
	path.join(LAB, "options-removed.html"),
	inject(optionsHtml, chromeStub({ removed: ["genshin", "hsr"] })),
	"utf8"
);

// —— 面板 + 品牌区（商店截图 1280×800）——
const stage = `<!doctype html>
<html lang="zh-CN">
	<head>
		<meta charset="utf-8" />
		<title>二游日历 · 商店截图</title>
		<style>
			* { box-sizing: border-box; }
			html, body { margin: 0; padding: 0; width: 1280px; height: 800px; overflow: hidden; }
			body {
				font-family: "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
				background: linear-gradient(135deg, #eef2ff 0%, #f8fafc 45%, #ecfeff 100%);
				display: flex; align-items: center; justify-content: center; gap: 64px;
				padding: 0 64px;
			}
			.brand { width: 460px; }
			.brand-head { display: flex; align-items: center; gap: 16px; margin-bottom: 22px; }
			.brand-head img { width: 76px; height: 76px; border-radius: 18px; box-shadow: 0 8px 20px rgba(37,99,235,.28); }
			.brand h1 { font-size: 42px; margin: 0; color: #0f172a; letter-spacing: 1px; }
			.tagline { font-size: 19px; color: #334155; margin: 0 0 26px; line-height: 1.6; }
			ul { list-style: none; padding: 0; margin: 0; }
			li { font-size: 17px; color: #1e293b; margin-bottom: 14px; padding-left: 30px; position: relative; line-height: 1.5; }
			li::before {
				content: ""; position: absolute; left: 0; top: 7px; width: 16px; height: 16px;
				border-radius: 50%; background: #2563eb;
				box-shadow: inset 0 0 0 4px #dbeafe;
			}
			.panel {
				width: 560px; height: 600px; flex: none; border-radius: 14px; overflow: hidden;
				box-shadow: 0 26px 60px rgba(15,23,42,.20), 0 2px 6px rgba(15,23,42,.10);
				background: #fff; border: 1px solid #e2e8f0;
			}
			iframe { width: 560px; height: 600px; border: 0; display: block; }
		</style>
	</head>
	<body>
		<div class="brand">
			<div class="brand-head">
				<img src="../src/icons/icon-128.png" alt="" />
				<h1>二游日历</h1>
			</div>
			<p class="tagline">28 款二次元手游的当期卡池与活动起止，一处看全。</p>
			<ul>
				<li>当期卡池 UP 角色与剩余时间</li>
				<li>活动起止一览，悬停看完整时间</li>
				<li>按来源自选，抓不到时可切换</li>
			</ul>
		</div>
		<div class="panel"><iframe src="popup.html"></iframe></div>
	</body>
</html>`;
fs.writeFileSync(path.join(LAB, "panel-1280x800.html"), stage, "utf8");

// —— 推广图（可选，但会出现在商店浏览页）——
const tileCss = `
	* { box-sizing: border-box; }
	html, body { margin: 0; padding: 0; overflow: hidden;
		font-family: "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif; }
	body { background: linear-gradient(135deg, #eef2ff 0%, #f8fafc 48%, #ecfeff 100%);
		display: flex; align-items: center; justify-content: center; }
`;

// 小型促销磁贴 440×280（商店要求精确尺寸）
fs.writeFileSync(
	path.join(LAB, "tile-440x280.html"),
	`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" /><title>小磁贴</title><style>${tileCss}
		html, body { width: 440px; height: 280px; }
		.box { display: flex; align-items: center; gap: 20px; padding: 0 34px; }
		img { width: 72px; height: 72px; border-radius: 16px; box-shadow: 0 8px 18px rgba(37,99,235,.28); }
		h1 { font-size: 34px; margin: 0 0 8px; color: #0f172a; letter-spacing: 1px; }
		p { font-size: 15px; margin: 0; color: #334155; line-height: 1.5; }
	</style></head><body>
		<div class="box">
			<img src="../src/icons/icon-128.png" alt="" />
			<div><h1>二游日历</h1><p>28 款手游卡池与活动起止<br />一处看全</p></div>
		</div>
	</body></html>`,
	"utf8"
);

// 大型促销磁贴 1400×560
fs.writeFileSync(
	path.join(LAB, "tile-1400x560.html"),
	`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" /><title>大磁贴</title><style>${tileCss}
		html, body { width: 1400px; height: 560px; }
		.box { display: flex; align-items: center; gap: 52px; padding: 0 96px; }
		img { width: 148px; height: 148px; border-radius: 34px; box-shadow: 0 16px 36px rgba(37,99,235,.30); }
		h1 { font-size: 68px; margin: 0 0 18px; color: #0f172a; letter-spacing: 2px; }
		p { font-size: 24px; margin: 0; color: #334155; line-height: 1.65; }
	</style></head><body>
		<div class="box">
			<img src="../src/icons/icon-128.png" alt="" />
			<div>
				<h1>二游日历</h1>
				<p>28 款二次元手游的当期卡池与活动起止，一处看全<br />当期 UP 角色 · 剩余时间 · 按来源自选</p>
			</div>
		</div>
	</body></html>`,
	"utf8"
);

// ---------- 3. 商店徽标 300×300 ----------
fs.mkdirSync(STORE_ASSETS, { recursive: true });
const logo = encodePng(300, 300, drawIcon(300));
fs.writeFileSync(path.join(STORE_ASSETS, "logo-300.png"), logo);

// ---------- 汇总 ----------
console.log(`\n夹具: ${path.relative(ROOT, LAB)}/`);
console.log("  popup.html              面板（README 截图）");
console.log("  panel-1280x800.html     面板 + 品牌区（商店截图 1280×800）");
console.log("  options.html            设置页（商店截图）");
console.log("  options-removed.html    设置页变体：预置已删除条目（展示恢复功能）");
console.log(`\n商店徽标: ${path.relative(ROOT, path.join(STORE_ASSETS, "logo-300.png"))}  ${logo.length} B（300×300）`);
console.log(`可见条目 ${visible.length} 个；顶部提示: ${info.info}`);
