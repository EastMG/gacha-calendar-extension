// i18n 消息工具：读取 `_locales/<locale>/messages.json`，并解析 manifest 里的 `__MSG_key__` 占位符。
//
// 为什么需要：
//   manifest 的 `name` / `description` 用 `__MSG_xxx__` 占位符后，**字面量本身是合法的**
//   （浏览器会在加载时用 `_locales` 解析）。所以校验器不能再简单地断言"不含 __MSG_"，
//   而要判断"**能否解析**" —— 缺了 `_locales` 或键名写错，扩展名会直接显示成 `__MSG_...__`，
//   那才是真正要拦的故障。另外商店的"简短说明 ≤132 字符"限制也是针对**解析后的值**。
import fs from "node:fs";
import path from "node:path";

/** i18n 键名允许的字符（Chrome 规定：字母数字下划线，且不以数字开头）。 */
const MSG_RE = /__MSG_([A-Za-z0-9_@]+)__/g;

/**
 * 读取某个目录下的全部 locale 消息。
 *
 * @param {string} baseDir 含 `_locales/` 的目录（dist 或仓库根）
 * @returns {{locales: Record<string, Record<string, string>>, dir: string|null}}
 */
export function readLocales(baseDir) {
	const dir = path.join(baseDir, "_locales");
	/** @type {Record<string, Record<string, string>>} */
	const locales = {};
	if (!fs.existsSync(dir)) return { locales, dir: null };
	for (const name of fs.readdirSync(dir)) {
		const f = path.join(dir, name, "messages.json");
		if (!fs.existsSync(f)) continue;
		try {
			const raw = JSON.parse(fs.readFileSync(f, "utf8"));
			/** @type {Record<string, string>} */
			const flat = {};
			for (const [k, v] of Object.entries(raw)) {
				if (v && typeof v === "object" && typeof v.message === "string") flat[k] = v.message;
			}
			locales[name] = flat;
		} catch {
			/* 坏 JSON 由调用方通过"解析失败"体现 */
		}
	}
	return { locales, dir };
}

/**
 * 解析一段可能含 `__MSG_key__` 的文本。
 *
 * @param {string} text
 * @param {Record<string, string>} messages 该 locale 的消息表
 * @returns {{ok: boolean, value: string, missing: string[]}}
 */
export function resolveMessages(text, messages) {
	const missing = [];
	const value = String(text ?? "").replace(MSG_RE, (whole, key) => {
		const v = messages && messages[key];
		if (typeof v !== "string") {
			missing.push(key);
			return whole;
		}
		return v;
	});
	return { ok: missing.length === 0, value, missing };
}

/**
 * 把 manifest 的 name/description 解析成"商店会看到的实际值"。
 *
 * @param {object} manifest
 * @param {string} baseDir 含 `_locales/` 的目录
 * @param {string} [locale] 目标语言；缺省用 manifest.default_locale，再缺省用第一个可用 locale
 * @returns {{name: string, description: string, problems: string[], locale: string|null, locales: string[]}}
 */
export function resolveManifestText(manifest, baseDir, locale) {
	const { locales } = readLocales(baseDir);
	const available = Object.keys(locales);
	const use = locale && locales[locale] ? locale : locales[manifest.default_locale] ? manifest.default_locale : available[0] || null;
	const problems = [];

	if (!use) {
		// 没有任何 _locales：只有当 manifest 不含占位符时才算正常
		const hasMsg = /__MSG_/.test(String(manifest.name || "")) || /__MSG_/.test(String(manifest.description || ""));
		if (hasMsg) problems.push("manifest 用了 __MSG_ 占位符，但包里没有 _locales 目录，无法解析");
		return { name: String(manifest.name || ""), description: String(manifest.description || ""), problems, locale: null, locales: available };
	}
	if (!manifest.default_locale) problems.push("manifest 缺少 default_locale 字段");
	else if (!locales[manifest.default_locale]) problems.push(`default_locale="${manifest.default_locale}" 但缺少 _locales/${manifest.default_locale}/messages.json`);

	const msgs = locales[use];
	const n = resolveMessages(manifest.name, msgs);
	const d = resolveMessages(manifest.description, msgs);
	if (!n.ok) problems.push(`name 的占位符在 _locales/${use} 里找不到键：${n.missing.join(", ")}`);
	if (!d.ok) problems.push(`description 的占位符在 _locales/${use} 里找不到键：${d.missing.join(", ")}`);

	return { name: n.value, description: d.value, problems, locale: use, locales: available };
}
