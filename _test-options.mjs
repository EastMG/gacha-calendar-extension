// 测设置页的新功能（在真实浏览器里跑，因为设置页需要 chrome.* API）：
//   1. 内联自定义地址输入框（选中「自定义…」后出现）
//   2. 删除条目 → 进入「已删除的条目」区 → 单独恢复
//   3. 全部恢复
//   4. 权限限制说明文案存在
//
// 取证方式：设置页把自测结果写进 chrome.storage.local 的固定键，脚本从 profile 的
// LevelDB 读回（本机 CDP 求值不通，这是已验证可用的通路）。
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = "F:/DeepSeek/DeepSeek-Workplace/DSH-Workplace-01/gacha-calendar-extension";
const DIST = path.join(ROOT, "dist");
const LAB = path.join(ROOT, "_opt-lab");
const PROFILE = path.join(ROOT, "_opt-profile");
const PORT = 9421;
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 造一个"设置页自测版"扩展：options.html 末尾追加一段自测脚本
fs.rmSync(LAB, { recursive: true, force: true });
fs.cpSync(DIST, LAB, { recursive: true });
const optHtml = fs.readFileSync(path.join(LAB, "options.html"), "utf8");
const probe = `
<script type="module">
// —— 设置页自测（仅验证版）——
const log = [];
const q = (s) => document.querySelector(s);
const qa = (s) => [...document.querySelectorAll(s)];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await wait(150); }
  return false;
}
(async () => {
  try {
    log.push("entries=" + qa(".entry").length);
    log.push("removedCardHidden=" + (q("#removed-card") ? q("#removed-card").hidden : "missing"));

    // 1. 切第一行的卡池来源到「自定义…」，应出现内联输入框
    const firstSel = qa(".entry select")[0];
    firstSel.value = "custom";
    firstSel.dispatchEvent(new Event("change", { bubbles: true }));
    const hasCustomField = await until(() => qa(".custom-field input").length > 0);
    log.push("customFieldAppeared=" + hasCustomField);
    const input = qa(".custom-field input")[0];
    if (input) {
      log.push("customFieldHasDatalist=" + (input.getAttribute("list") === "allowed-hosts"));
      log.push("datalistOptions=" + qa("#allowed-hosts option").length);
    }

    // 2. 删除第一个条目
    const delBtn = qa(".entry .btn.danger")[0];
    const firstNameBefore = qa(".entry .g-name span")[0].textContent;
    log.push("firstName=" + firstNameBefore);
    delBtn.click();
    const enteredRemoved = await until(() => q("#removed-card") && !q("#removed-card").hidden);
    log.push("removedCardShown=" + enteredRemoved);
    log.push("removedRows=" + qa(".removed-row").length);
    log.push("removedFirstName=" + (q(".removed-row span") ? q(".removed-row span").textContent : ""));
    log.push("entriesAfterDelete=" + qa(".entry").length);

    // 3. 恢复该条目
    const restoreBtn = q(".removed-row .btn");
    if (restoreBtn) restoreBtn.click();
    const restored = await until(() => qa(".entry").length > 0 && (q("#removed-card") ? q("#removed-card").hidden : true));
    log.push("restored=" + restored);
    log.push("entriesAfterRestore=" + qa(".entry").length);
    log.push("firstNameAfterRestore=" + (qa(".entry .g-name span")[0] ? qa(".entry .g-name span")[0].textContent : ""));

    // 4. 权限限制说明
    log.push("permissionNote=" + qa("p.hint").some((p) => /浏览器扩展权限限制/.test(p.textContent)));

    // 5. 全部恢复按钮（先删两个再全部恢复）
    const dels = qa(".entry .btn.danger");
    if (dels[0]) dels[0].click(); await wait(400);
    const dels2 = qa(".entry .btn.danger");
    if (dels2[0]) dels2[0].click(); await wait(400);
    log.push("removedBeforeRestoreAll=" + qa(".removed-row").length);
    const all = qa("#removed-list .btn").find((b) => b.textContent === "全部恢复");
    if (all) all.click();
    const allRestored = await until(() => (q("#removed-card") ? q("#removed-card").hidden : false));
    log.push("restoreAll=" + allRestored);
    log.push("entriesFinal=" + qa(".entry").length);
  } catch (e) {
    log.push("ERROR=" + String((e && e.message) || e));
  }
  await chrome.storage.local.set({ __opt_report: log.join("\\n"), __opt_at: Date.now() });
})();
</script>`;
fs.writeFileSync(path.join(LAB, "options.html"), optHtml.replace("</body>", probe + "\n\t</body>"), "utf8");

// 启动并打开设置页
fs.rmSync(PROFILE, { recursive: true, force: true });
const out = fs.openSync(path.join(ROOT, "_opt-out.txt"), "w");
const child = spawn(
	EDGE,
	[
		`--user-data-dir=${PROFILE}`,
		`--load-extension=${LAB}`,
		`--disable-extensions-except=${LAB}`,
		`--remote-debugging-port=${PORT}`,
		"--no-first-run",
		"--no-default-browser-check",
		"about:blank"
	],
	{ stdio: ["ignore", out, out] }
);

let extId = null;
for (let i = 0; i < 60 && !extId; i++) {
	await sleep(500);
	try {
		const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
		for (const t of list) {
			if (t.type !== "service_worker" || !t.url.startsWith("chrome-extension://")) continue;
			const id = new URL(t.url).host;
			await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(`chrome-extension://${id}/options.html`)}`, { method: "PUT" }).catch(() => {});
			await sleep(1200);
			const l2 = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
			const pg = l2.find((p) => p.type === "page" && p.url.includes(id) && p.url.includes("options.html"));
			if (pg && /设置/.test(pg.title || "")) extId = id;
		}
	} catch {
		/* DevTools 接口尚未就绪，重试 */
	}
}
console.log("设置页扩展 ID:", extId);

await sleep(12000);
try { child.kill(); } catch {}
await sleep(3000);
fs.closeSync(out);

// 读回报告
const base = path.join(PROFILE, "Default", "Local Extension Settings");
let report = null;
const scan = (dir) => {
	if (!fs.existsSync(dir)) return;
	for (const id of fs.readdirSync(dir)) {
		const d = path.join(dir, id);
		for (const f of fs.readdirSync(d)) {
			if (!/\.(log|ldb)$/.test(f)) continue;
			const buf = fs.readFileSync(path.join(d, f));
			for (const enc of ["utf8", "utf16le", "latin1"]) {
				const t = buf.toString(enc);
				const idx = t.indexOf("entries=");
				if (idx >= 0 && /removedCardHidden=/.test(t)) {
					const seg = t.slice(idx, idx + 900);
					const cand = seg.split(/[\x00-\x08\x0e-\x1f]/)[0];
					report = { enc, text: cand };
					return;
				}
			}
		}
	}
};
scan(base);

console.log("\n=== 设置页自测报告 ===");
if (report) console.log(report.text.replace(/\\n/g, "\n"));
else console.log("（没读到报告；可能设置页未加载或写入未落盘）");

fs.rmSync(LAB, { recursive: true, force: true });
try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {}
