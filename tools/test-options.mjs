// 用极简 DOM shim 在 Node 里跑 **真实的 src/options.js**，验证设置页行为。
//
// 为什么不用浏览器：本机的浏览器自动化取证一直不可靠（CDP 求值不通、扩展页 dump 受限、
// 报告落盘时机不稳）。而 options.js 的逻辑本身是可以用假 DOM 精确驱动的 —— 确定性更高，
// 且能断言"点了删除之后 storage 里到底写了什么"。
//
// shim 只实现 options.js 实际用到的 API；DOM 不完整，但足够覆盖增删改的逻辑路径。
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = "F:/DeepSeek/DeepSeek-Workplace/DSH-Workplace-01/gacha-calendar-extension";

// ---------- 极简 DOM ----------
class El {
	constructor(tag = "div") {
		this.tagName = String(tag).toUpperCase();
		this.children = [];
		this.parent = null;
		this.listeners = new Map();
		this.attributes = new Map();
		this.dataset = {};
		this.style = {};
		this._text = "";
		this._value = "";
		this.hidden = false;
		this.disabled = false;
		this.checked = false;
		this.classList = {
			_t: new Set(),
			add: (...c) => c.forEach((x) => this.classList._t.add(x)),
			remove: (...c) => c.forEach((x) => this.classList._t.delete(x)),
			contains: (c) => this.classList._t.has(c)
		};
	}
	get className() {
		return [...this.classList._t].join(" ");
	}
	set className(v) {
		this.classList._t = new Set(String(v || "").split(/\s+/).filter(Boolean));
	}
	get textContent() {
		if (this.children.length) return this.children.map((c) => c.textContent).join("");
		return this._text;
	}
	set textContent(v) {
		this._text = String(v);
		this.children = [];
	}
	get value() {
		return this._value;
	}
	set value(v) {
		this._value = String(v);
	}
	setAttribute(k, v) {
		this.attributes.set(k, String(v));
	}
	getAttribute(k) {
		return this.attributes.has(k) ? this.attributes.get(k) : null;
	}
	appendChild(c) {
		if (c && c.__fragment) {
			for (const k of c.children) this.appendChild(k);
			return c;
		}
		c.parent = this;
		this.children.push(c);
		return c;
	}
	append(...cs) {
		cs.forEach((c) => this.appendChild(c));
		return this;
	}
	replaceChildren(...cs) {
		this.children = [];
		for (const c of cs) this.appendChild(c);
	}
	addEventListener(type, fn) {
		if (!this.listeners.has(type)) this.listeners.set(type, []);
		this.listeners.get(type).push(fn);
	}
	/** 触发监听器（模拟用户操作）。 */
	fire(type) {
		for (const fn of this.listeners.get(type) || []) fn({ target: this, key: undefined });
	}
	/** 让 fire 能带键盘事件参数 */
	fireKey(type, key) {
		for (const fn of this.listeners.get(type) || []) fn({ target: this, key });
	}
	querySelectorAll(sel) {
		const spec = parseSel(sel);
		const out = [];
		const walk = (n) => {
			for (const c of n.children) {
				if (matches(c, spec)) out.push(c);
				walk(c);
			}
		};
		walk(this);
		return out;
	}
	querySelector(sel) {
		return this.querySelectorAll(sel)[0] || null;
	}
	/** <select> 的 options：真实 DOM 上是一个 HTMLOptionsCollection，代码里会遍历它。 */
	get options() {
		return this.children.filter((c) => c.tagName === "OPTION");
	}
	/**
	 * 模拟用户改值并派发事件。
	 * 注意：真实浏览器里 select/input 的 value 是"用户操作后的即时值"，
	 * 而本 shim 的 value 需要显式设置 —— 所以先写值再派发，避免测出假结果。
	 */
	fireChange(value) {
		if (value !== undefined) this.value = value;
		this.fire("change");
	}
}

/** 支持 #id、.class、tag、以及它们的组合（够本项目用）。 */
function parseSel(sel) {
	const s = String(sel).trim();
	if (s.startsWith("#")) return { id: s.slice(1) };
	if (s.startsWith(".")) return { cls: s.slice(1) };
	return { tag: s.toUpperCase() };
}
function matches(el, spec) {
	if (spec.id) return el.attributes.get("id") === spec.id || el.id === spec.id;
	if (spec.cls) return el.classList.contains(spec.cls);
	if (spec.tag) return el.tagName === spec.tag;
	return false;
}

class Frag extends El {
	constructor() {
		super("fragment");
		this.__fragment = true;
	}
}

const registry = new Map();
function mk(tag) {
	return new El(tag);
}
const document = {
	createElement: (t) => mk(t),
	createDocumentFragment: () => new Frag(),
	/** 预置的顶层元素（对应 options.html 里带 id 的节点） */
	getElementById: (id) => {
		if (!registry.has(id)) {
			const e = mk("div");
			e.id = id;
			e.setAttribute("id", id);
			registry.set(id, e);
		}
		return registry.get(id);
	},
	querySelector: () => null,
	querySelectorAll: () => []
};

// options.html 里真实存在的 id（缺了 options.js 会在取元素时报错，这里据此校验）
const HTML_IDS = [
	"count",
	"entries",
	"allowed-hosts",
	"autoRefresh",
	"refreshMinutes",
	"resetOrder",
	"removed-card",
	"removed-list",
	"selfCheck",
	"sc-summary",
	"sc-list",
	"ver",
	"core-ver"
];
for (const id of HTML_IDS) document.getElementById(id);

// ---------- chrome.* shim ----------
const store = new Map();
let messageHandler = null;
globalThis.chrome = {
	runtime: {
		getManifest: () => ({
			version: "0.0.0-test",
			host_permissions: [
				"https://wiki.biligame.com/*",
				"https://prts.wiki/*",
				"https://storage.moegirl.org.cn/*"
			]
		}),
		sendMessage: async (msg) => {
			if (messageHandler) return messageHandler(msg);
			return { ok: false, error: "no-handler" };
		},
		onMessage: {
			addListener: (fn) => {
				messageHandler = fn;
			}
		}
	},
	storage: {
		local: {
			get: async (k) => {
				if (k === null || k === undefined) return Object.fromEntries(store);
				if (typeof k === "string") return store.has(k) ? { [k]: store.get(k) } : {};
				const out = {};
				for (const key of k) if (store.has(key)) out[key] = store.get(key);
				return out;
			},
			set: async (patch) => {
				for (const [k, v] of Object.entries(patch)) store.set(k, v);
			}
		}
	}
};
globalThis.document = document;
globalThis.window = globalThis;
globalThis.URL = URL;

// ---------- 用假 core 替掉真包（只提供 options.js 用到的那几个接口）----------
// 通过 import map 不可行，故改用"把 options.js 里对 gacha-calendar-core 的 import 改掉"
// 的方式在临时副本里跑 —— 这样测的仍是**仓库里真实的 options.js 源码**。
const LAB = path.join(ROOT, "_opt-node-lab");
fs.rmSync(LAB, { recursive: true, force: true });
fs.mkdirSync(LAB, { recursive: true });
let src = fs.readFileSync(path.join(ROOT, "src", "options.js"), "utf8");
src = src.replace(
	'from "gacha-calendar-core"',
	`from ${JSON.stringify(pathToFileURL(path.join(LAB, "fake-core.mjs")).href)}`
);
src = src.replace('from "./storage.js"', `from ${JSON.stringify(pathToFileURL(path.join(LAB, "storage.mjs")).href)}`);
src = src.replace('from "./transport.js"', `from ${JSON.stringify(pathToFileURL(path.join(LAB, "transport.mjs")).href)}`);
// core 版本文件按相对路径被 import，放在同目录即可
fs.copyFileSync(path.join(ROOT, "src", "storage.js"), path.join(LAB, "storage.mjs"));
fs.writeFileSync(
	path.join(LAB, "transport.mjs"),
	`export const transport = { fetchRaw() { throw new Error("no-net"); }, fetchViaProxy() { throw new Error("no-net"); } };\n`,
	"utf8"
);
fs.writeFileSync(path.join(LAB, "core-version.js"), `export const CORE_VERSION = "0.0.0-test";\n`, "utf8");

const SOURCES = [
	{ id: "genshin", name: "原神", icon: "https://storage.moegirl.org.cn/a.png", source: "Bwiki", altSources: [{ label: "备选源A", value: "https://alt1/" }] },
	{ id: "hsr", name: "崩坏：星穹铁道", icon: "https://storage.moegirl.org.cn/b.png", source: "Bwiki" },
	{ id: "zzz", name: "绝区零", icon: "https://storage.moegirl.org.cn/c.png", source: "官方公告" }
];
fs.writeFileSync(
	path.join(LAB, "fake-core.mjs"),
	`export function createEngine() {
  return {
    __test: { SOURCES: ${JSON.stringify(SOURCES)} },
    async listGames() {
      // 与真实 core 的 getAllEntries 一致：
      //   removed 用 Array.isArray 读（原生数组）；customEntries 用 parseJsonStr 读（JSON 字符串）
      const cfg = await chrome.storage.local.get(["removed", "customEntries"]);
      const removed = Array.isArray(cfg.removed) ? cfg.removed : [];
      let customs = [];
      try { customs = JSON.parse(cfg.customEntries || "[]") || []; } catch { customs = []; }
      return [...${JSON.stringify(SOURCES)}, ...(Array.isArray(customs) ? customs : [])]
        .filter((g) => !removed.includes(g.id))
        .map((g) => ({ ...g, custom: !!g.custom, hidden: false }));
    },
    async selfCheck() { return { total: 3, summary: { ok: 3, nomatch: 0, down: 0 }, problems: [] }; }
  };
}
`,
	"utf8"
);
fs.writeFileSync(path.join(LAB, "options-under-test.mjs"), src, "utf8");

// ---------- 跑起来并断言 ----------
let failed = 0;
const check = (name, ok, detail = "") => {
	console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? "  " + detail : ""}`);
	if (!ok) failed++;
};

// 捕获 options.js 里任何未被其自身 catch 吞掉的异常/拒绝，便于定位
const asyncErrors = [];
process.on("uncaughtException", (e) => asyncErrors.push("uncaught: " + String((e && e.stack) || e)));
process.on("unhandledRejection", (e) => asyncErrors.push("rejection: " + String((e && e.stack) || e)));

try {
	await import(pathToFileURL(path.join(LAB, "options-under-test.mjs")).href);
} catch (e) {
	console.error("✗ import options.js 失败:\n" + String((e && e.stack) || e));
	process.exit(1);
}
// 等入口的异步初始化完成
for (let i = 0; i < 200; i++) {
	await new Promise((r) => setTimeout(r, 25));
	if (document.getElementById("entries").children.length > 0) break;
}
if (asyncErrors.length) {
	console.error("options.js 抛出了异常：");
	for (const e of asyncErrors) console.error("  " + e);
	process.exit(1);
}
const entriesEl = document.getElementById("entries");
if (entriesEl.children.length === 0) {
	console.error("✗ 渲染为空。诊断：");
	console.error(`  count 文本 = ${JSON.stringify(document.getElementById("count").textContent)}`);
	console.error(`  entries children = ${entriesEl.children.length}`);
	process.exit(1);
}

const entries = () => document.getElementById("entries").children;
const removedList = () => document.getElementById("removed-list").children;

console.log("=== 初始渲染 ===");
check("渲染出 3 个条目", entries().length === 3, `${entries().length} 个`);
check("条目行含来源下拉", entries()[0].querySelectorAll("select").length === 2, `${entries()[0].querySelectorAll("select").length} 个 select`);
check("操作区含 ↑ ↓ 删除", entries()[0].querySelectorAll("button").length === 3);
check("已删除区初始隐藏", document.getElementById("removed-card").hidden === true);
check("权限限制说明已写入 datalist", document.getElementById("allowed-hosts").children.length === 2, `${document.getElementById("allowed-hosts").children.length} 个候选主机`);

console.log("\n=== 切到「自定义…」应出现内联输入框（而非 prompt 弹窗）===");
const gachaSel = entries()[0].querySelectorAll("select")[0];
gachaSel.fireChange("custom");
await new Promise((r) => setTimeout(r, 120));
const customInputs = entries()[0].querySelectorAll(".custom-field");
check("内联输入行出现", customInputs.length === 1, `${customInputs.length} 行`);
const inp = entries()[0].querySelector(".custom-field").querySelector("input");
check("输入框绑定了主机候选 datalist", inp && inp.getAttribute("list") === "allowed-hosts");
const _urls = JSON.parse(store.get("customUrls") || "{}");
check("storage 里写入 custom: 前缀（core 契约：JSON 字符串）", /^custom:/.test(String(_urls.genshin || "")), store.get("customUrls"));
// 填入地址并触发 change
inp.value = "https://prts.wiki/api.php?action=parse";
inp.fireChange();
await new Promise((r) => setTimeout(r, 60));
check("填入地址后落盘", String(JSON.parse(store.get("customUrls") || "{}").genshin || "").includes("prts.wiki"), store.get("customUrls"));

console.log("\n=== 删除条目 ===");
const del = entries()[0].querySelectorAll("button").find((b) => b.textContent === "删除");
try {
	del.fire("click");
	await new Promise((r) => setTimeout(r, 120));
} catch (e) {
	console.error("  删除按钮触发时抛错 → " + String((e && e.stack) || e));
	process.exit(3);
}
if (asyncErrors.length) {
	console.error("  删除过程中出现异步异常：");
	for (const e of asyncErrors) console.error("    " + e);
}
// storage 里 removed 是数组（自然类型），不是 JSON 字符串 —— 与 options.js 的类型约定一致
const _removedArr = store.get("removed") || [];

check("removed 写入 genshin", JSON.stringify(_removedArr) === '["genshin"]', JSON.stringify(_removedArr));
check("条目数减到 2", entries().length === 2, `${entries().length} 个`);
check("已删除区显示", document.getElementById("removed-card").hidden === false);
check("已删除区列出该条目", removedList().length > 0 && removedList()[0].querySelector("span").textContent === "原神", removedList()[0]?.querySelector("span")?.textContent);
check("删除时清掉了该条目的自定义地址", !("genshin" in JSON.parse(store.get("customUrls") || "{}")), store.get("customUrls"));

console.log("\n=== 单独恢复 ===");
removedList()[0].querySelector("button").fire("click");
await new Promise((r) => setTimeout(r, 80));
check("removed 清空", JSON.stringify(store.get("removed") || []) === "[]", store.get("removed"));
check("条目数回到 3", entries().length === 3, `${entries().length} 个`);
check("名字正确还原（原神）", entries()[0].querySelector(".g-name").querySelector("span").textContent === "原神");
check("已删除区重新隐藏", document.getElementById("removed-card").hidden === true);

console.log("\n=== 批量删除 + 全部恢复 ===");
entries()[0].querySelectorAll("button").find((b) => b.textContent === "删除").fire("click");
await new Promise((r) => setTimeout(r, 80));
entries()[0].querySelectorAll("button").find((b) => b.textContent === "删除").fire("click");
await new Promise((r) => setTimeout(r, 80));
check("删了两个后 removed 有 2 项", (store.get("removed") || []).length === 2, store.get("removed"));
const allBtn = removedList().flatMap((n) => n.querySelectorAll("button")).find((b) => b.textContent === "全部恢复");
check("存在「全部恢复」按钮", allBtn && allBtn.textContent === "全部恢复", allBtn?.textContent);
allBtn.fire("click");
await new Promise((r) => setTimeout(r, 80));
check("全部恢复后 removed 清空", (store.get("removed") || []).length === 0);
check("条目数回到 3", entries().length === 3, `${entries().length} 个`);

fs.rmSync(LAB, { recursive: true, force: true });
console.log("");
if (failed) {
	console.log(`✗ ${failed} 项未通过`);
	process.exit(1);
}
console.log("✓ 设置页行为验证全部通过（删除 / 单独恢复 / 全部恢复 / 内联自定义地址）");
