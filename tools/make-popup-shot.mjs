// 生成"面板截图"用的离线夹具（供真实浏览器渲染 dist/popup.html 截图）。
//
// 为什么需要它：
//   面板截图 `assets/popup.png` 是"扩展在真实浏览器里能渲染"的证据。核心改名后旧截图
//   还写着旧名，需要重拍；但直接在扩展里截图依赖 CDP（本机不通），
//   所以改成：**在 Node 里用真网络跑一轮 core 拿到真实缓存** → 把缓存灌进一个
//   chrome.* 桩 → 用真实浏览器打开 dist/popup.html 渲染 → 截图。
//   这样截出来的仍是**构建产物本身**（dist/popup.js + dist/popup.css），只是数据来自离线种子，
//   不需要浏览器内跨域。
//
// 用法：node tools/make-popup-shot.mjs   → 产出 _shot/ 目录，用浏览器打开其中的 popup.html
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const OUT = path.join(ROOT, "_shot");

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

const corePkgPath = path.join(ROOT, "node_modules", "gacha-calendar-core", "package.json");
const corePkg = JSON.parse(fs.readFileSync(corePkgPath, "utf8"));
const { createEngine } = await import(pathToFileURL(path.join(path.dirname(corePkgPath), corePkg.main)).href);

const mem = new Map();
const engine = createEngine({ transport: makeTransport(), storage: { async get(k) { return mem.get(k); }, async set(k, v) { mem.set(k, v); } } });

console.log(`core ${corePkg.version}：真网络抓一轮…`);
const result = await engine.refresh();
const ids = Object.keys(result.games);
const has = (v) => typeof v === "string" && v.length > 0;
console.log(`  卡池 ${ids.filter((i) => has(result.games[i].banner)).length}/${ids.length}，活动 ${ids.filter((i) => has(result.games[i].event)).length}/${ids.length}`);

// 只保留"面板默认会显示"的条目（排除出厂默认隐藏项），截图与用户首开所见一致
const hiddenIds = engine.__test.SOURCES.filter((s) => s.defaultHidden).map((s) => s.id);
const games = await engine.listGames();
const visible = games.filter((g) => !hiddenIds.includes(g.id));

// 面板顶部提示：用 popup 同一份纯函数算（这里直接内联一份等价调用）
const { buildScrapeInfo, buildRowModel, defaultRecord } = await import(
	pathToFileURL(path.join(ROOT, "src", "view-helpers.js")).href
);
const info = buildScrapeInfo(visible.map((g) => ({ id: g.id, name: g.name })), result);

// 组装夹具
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const f of ["popup.js", "popup.css"]) fs.copyFileSync(path.join(DIST, f), path.join(OUT, f));

const seed = {
	autoRefresh: false, // 关掉自动抓取，避免打开时联网（截图用缓存即可）
	refreshMinutes: 24 * 60,
	lastSource: "web",
	lastRefresh: Date.now(),
	lastData: mem.get("lastData"),
	hidden: [],
	shown: [],
	order: [],
	// 让面板顶部那行"抓取结论"也出现（popup 只在 doRefresh 后设置，这里直接喂）
	__scrapeInfo: info.info
};

const stub = `<script>
// 面板离线夹具：用真实构建产物 + 预置的真实缓存渲染，不联网。
window.__SEED__ = ${JSON.stringify(seed)};
(() => {
  const store = { ...window.__SEED__ };
  delete store.__scrapeInfo;
  window.__STORE__ = store;
  window.__SCRAPE__ = window.__SEED__.__scrapeInfo || "";
  window.chrome = {
    runtime: {
      id: "popupshot",
      getManifest: () => ({ manifest_version: 3, name: "二游日历", version: "0.0.0", host_permissions: [] }),
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

let html = fs.readFileSync(path.join(ROOT, "src", "popup.html"), "utf8");
html = html.replace('<script type="module" src="popup.js"></script>', stub + '\n\t\t<script type="module" src="popup.js"></script>');
// 让"面板顶部提示"这行也显示出来（popup 只在刷新后设置它，夹具里补一段）
html = html.replace(
	"</body>",
	`<script type="module">
// 夹具专用：把抓取结论喂给面板那行提示（真实扩展里由 doRefresh 设置）
setTimeout(() => {
  const s = document.getElementById("scrape");
  if (s && window.__SCRAPE__) { s.hidden = false; s.textContent = window.__SCRAPE__; }
}, 400);
</script>
\t</body>`
);
fs.writeFileSync(path.join(OUT, "popup.html"), html, "utf8");

console.log(`\n夹具已生成: ${path.relative(ROOT, OUT)}/popup.html`);
console.log(`  可见条目 ${visible.length} 个（已排除 ${hiddenIds.length} 个出厂默认隐藏项）`);
console.log(`  顶部提示: ${info.info}`);
