// 来源域名守卫：把 core 实际抓取的域名，与扩展的 manifest / background 白名单逐一对齐。
//
// 为什么值得单独做一个检查（这是本项目最危险的失误类型）：
//   core 一换来源，扩展就必须同步申请 host_permissions，否则该来源在浏览器里
//   **静默失败** —— 不报错、不提示，只是那一行没数据，肉眼极难定位。
//   实际发生过：core 给重返未来 1999 换成官方游戏内公告接口（notice.sl916.com），
//   扩展漏配该域名 → 1999 完全抓不到。
//
// 检查内容：
//   1. 从 core 产物（node_modules 里那份，也就是构建时内联进去的那份）提取真实抓取 URL
//   2. 这些域名必须都在 manifest.host_permissions 里，且（非图标域名）都在 background 白名单里
//   3. 反向报告"已申请但 core 不再使用"的域名，供人工决定是否清理权限面
//
// 用法：node tools/check-domains.mjs
//   退出码 0 = 通过；1 = 有缺失（会把缺哪个域名、怎么加打印出来）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const CORE_PKG = path.join(ROOT, "node_modules", "gacha-calendar-core", "package.json");
const MANIFEST = path.join(ROOT, "manifest.json");
const BACKGROUND = path.join(ROOT, "src", "background.js");

/** 只用于 <img> 的域名：需要 host_permissions（否则图标不显示），但不需要进抓取白名单。 */
const ICON_HOSTS = new Set(["storage.moegirl.org.cn", "webcnstatic.yostar.net", "play-lh.googleusercontent.com"]);

/** 非抓取用途的域名：SVG 命名空间、Markdown 文档链接等，不该被当成来源。 */
function isNoise(host) {
	if (host === "www.w3.org") return true;
	if (host === "github.com" || host.endsWith(".github.com")) return true;
	if (host === "registry.npmjs.org") return true;
	if (host === "npmjs.com" || host.endsWith(".npmjs.com")) return true;
	if (host === "deepseek.com" || host.endsWith(".deepseek.com")) return true;
	return false;
}

function readCoreText() {
	if (!fs.existsSync(CORE_PKG)) {
		console.error("✗ 未安装 gacha-calendar-core，请先安装依赖");
		process.exit(1);
	}
	const pkg = JSON.parse(fs.readFileSync(CORE_PKG, "utf8"));
	const main = path.join(path.dirname(CORE_PKG), pkg.main || "core.mjs");
	return { version: pkg.version, text: fs.readFileSync(main, "utf8"), file: main };
}

/**
 * 从文本里提取"真实抓取 URL"的域名。
 * 只取 host 后紧跟 `/` 的完整 URL —— 这样能排除掉两种噪声：
 *   - 裸域名 referer（如 "https://bluearchive.jp/" 会被保留，因为它确实带斜杠…）
 *   - 文档里的相对链接
 * 另外排除 SVG 命名空间等非抓取域名。
 */
export function extractFetchHosts(text) {
	const hosts = new Set();
	for (const m of text.matchAll(/https?:\/\/[A-Za-z0-9.\-]+\//g)) {
		try {
			const h = new URL(m[0]).hostname;
			if (!isNoise(h)) hosts.add(h);
		} catch {
			/* ignore */
		}
	}
	return hosts;
}

export function readManifestHosts() {
	const mf = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
	return new Set(mf.host_permissions.map((h) => h.replace(/^https:\/\//, "").replace(/\/\*$/, "")));
}

export function readAllowHosts() {
	const src = fs.readFileSync(BACKGROUND, "utf8");
	const block = src.match(/const ALLOW_HOSTS = \[([\s\S]*?)\];/);
	if (!block) throw new Error("无法从 src/background.js 解析 ALLOW_HOSTS");
	return new Set([...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
}

/** 白名单命中：精确或父域（background 用 endsWith("." + allow) 匹配）。 */
export function allowedBy(allow, host) {
	return [...allow].some((a) => host === a || host.endsWith("." + a));
}

/** 执行检查，返回结论（不打印、不退出），供 verify.mjs 与钩子复用。 */
export function analyzeDomains() {
	const core = readCoreText();
	const fetchHosts = extractFetchHosts(core.text);
	const manifestHosts = readManifestHosts();
	const allow = readAllowHosts();

	const missingManifest = [...fetchHosts].filter((h) => !manifestHosts.has(h)).sort();
	// 图标域名不需要进抓取白名单
	const fetchHostsNeedingAllow = [...fetchHosts].filter((h) => !ICON_HOSTS.has(h));
	const missingAllow = fetchHostsNeedingAllow.filter((h) => !allowedBy(allow, h)).sort();

	// 反向：申请了但 core 不再抓取的（图标域名不算）
	const unusedManifest = [...manifestHosts].filter((h) => !fetchHosts.has(h) && !ICON_HOSTS.has(h)).sort();
	const unusedAllow = [...allow].filter((h) => !allowedBy(fetchHosts, h) && !fetchHosts.has(h)).sort();

	return {
		coreVersion: core.version,
		fetchHosts: [...fetchHosts].sort(),
		manifestHosts: [...manifestHosts].sort(),
		allow: [...allow].sort(),
		missingManifest,
		missingAllow,
		unusedManifest,
		unusedAllow
	};
}

// —— 作为脚本直接运行 ——
if (process.argv[1] && process.argv[1].endsWith("check-domains.mjs")) {
	const r = analyzeDomains();
	console.log(`来源域名守卫（core ${r.coreVersion}）`);
	console.log(`  core 实际抓取域名 ${r.fetchHosts.length} 个 / manifest ${r.manifestHosts.length} 条 / 白名单 ${r.allow.length} 条`);

	let failed = 0;
	if (r.missingManifest.length) {
		failed++;
		console.error(`\n✗ 有 ${r.missingManifest.length} 个域名没在 manifest.host_permissions 里（会导致静默抓不到）：`);
		for (const h of r.missingManifest) console.error(`    ${h}`);
		console.error("  修法：在 manifest.json 的 host_permissions 里加 \"https://<域名>/*\"");
	}
	if (r.missingAllow.length) {
		failed++;
		console.error(`\n✗ 有 ${r.missingAllow.length} 个域名没在 src/background.js 的 ALLOW_HOSTS 里：`);
		for (const h of r.missingAllow) console.error(`    ${h}`);
		console.error("  修法：把域名加进 ALLOW_HOSTS（background 会按精确/父域匹配）");
	}
	if (r.unusedManifest.length) {
		console.log(`\n提示：以下 ${r.unusedManifest.length} 个域名已申请但 core 当前不再使用（可清理以缩小权限面）：`);
		for (const h of r.unusedManifest) console.log(`    ${h}`);
	}
	if (r.unusedAllow.length) {
		console.log(`\n提示：以下 ${r.unusedAllow.length} 个域名在白名单里但 core 当前不再使用：`);
		for (const h of r.unusedAllow) console.log(`    ${h}`);
	}

	if (failed) {
		console.error(`\n✗ 域名覆盖检查未通过（${failed} 类问题）`);
		process.exit(1);
	}
	console.log("\n✓ 域名覆盖完整（core 抓取的每个域名都已授权）");
}
