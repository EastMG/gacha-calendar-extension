// iCalendar（RFC 5545）生成 —— **纯函数、无依赖**，方便单测。
//
// 为什么自己实现而不复用 core 的 `icsEventsOf` / `icsOf`：
//   它们确实存在于 gacha-calendar-core 里（排期导出 .ics 那段），但**没有导出**
//   （既不在 createEngine 的公开 API 上，也不在 `__test` 里）。
//   依赖内部实现随时可能断，所以扩展自己生成；字段口径与面板显示保持一致。
//
// 时间口径：DTSTART/DTEND 用**浮动本地时间**（不带 `Z`、不带 TZID）。
//   数据里只有"本机时区换算后的 MM-DD HH:MM 文本"，导出成浮动时间后，
//   日历应用按用户本机时区解释，与面板上看到的钟点一致。
//   DTSTAMP 按 RFC 要求用 UTC（`Z` 结尾）。

const CRLF = "\r\n";

/** 32 位 FNV-1a：给 UID 用（同一输入永远同一 UID ⇒ 重复导入不会产生重复日程）。 */
export function fnv1a(str) {
	let h = 0x811c9dc5;
	for (const ch of String(str)) {
		h ^= ch.codePointAt(0);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h.toString(16).padStart(8, "0");
}

/** RFC 5545 TEXT 转义：反斜杠、分号、逗号、换行。 */
export function icsEscapeText(value) {
	return String(value == null ? "" : value)
		.replace(/\\/g, "\\\\")
		.replace(/;/g, "\\;")
		.replace(/,/g, "\\,")
		.replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * 单个码点的 UTF-8 字节数（1/2/3/4）。
 *
 * ⚠️ 不能用 Node 的 `Buffer.byteLength`：这段代码会**打包进扩展、在浏览器里跑**，
 *    浏览器没有 Buffer（v0.2.32 就踩过：点导出直接 `Buffer is not defined`）。
 *    也不要用 TextEncoder 逐字符建实例（慢），按码点区间算即可，结果与 UTF-8 编码一致。
 */
function utf8Bytes(ch) {
	const cp = ch.codePointAt(0) || 0;
	if (cp < 0x80) return 1;
	if (cp < 0x800) return 2;
	if (cp < 0x10000) return 3;
	return 4;
}

/**
 * 折行（RFC 5545 §3.1）：一行不超过 **75 个 octet**，续行以一个空格开头。
 * ⚠️ 必须按 UTF-8 **字节**折，不能按字符数折，也不能把多字节字符劈成两半。
 * @param {string} line 已转义的内容行（不含 CRLF）
 * @returns {string} 折行后的文本（以 CRLF 连接）
 */
export function icsFold(line) {
	const s = String(line == null ? "" : line);
	const out = [];
	let cur = "";
	let curBytes = 0;
	// 首行上限 75 octet；续行以 1 空格开头，故内容上限 74 octet
	let limit = 75;
	for (const ch of s) {
		const bytes = utf8Bytes(ch);
		if (curBytes + bytes > limit) {
			out.push(cur);
			cur = "";
			curBytes = 0;
			limit = 74; // 续行的首字符前会补一个空格
		}
		cur += ch;
		curBytes += bytes;
	}
	out.push(cur);
	return out
		.map((part, i) => (i === 0 ? part : " " + part))
		.join(CRLF);
}

function pad2(n) {
	return String(n).padStart(2, "0");
}

/** UTC 时间戳：`YYYYMMDDTHHMMSSZ`（DTSTAMP 用）。 */
export function utcStamp(ms) {
	const d = new Date(ms);
	return (
		d.getUTCFullYear() +
		pad2(d.getUTCMonth() + 1) +
		pad2(d.getUTCDate()) +
		"T" +
		pad2(d.getUTCHours()) +
		pad2(d.getUTCMinutes()) +
		pad2(d.getUTCSeconds()) +
		"Z"
	);
}

/** 浮动本地时间：`YYYYMMDDTHHMMSS`（DTSTART / DTEND 用，按用户本机时区解释）。 */
export function localStamp(ms) {
	const d = new Date(ms);
	return (
		d.getFullYear() +
		pad2(d.getMonth() + 1) +
		pad2(d.getDate()) +
		"T" +
		pad2(d.getHours()) +
		pad2(d.getMinutes()) +
		pad2(d.getSeconds())
	);
}

/**
 * 生成整份 iCalendar 文本。
 *
 * @param {Array<{uid?:string,startTs:number,endTs:number,summary:string,description?:string}>} events
 * @param {number} generatedAt 生成时刻（ms）；决定 DTSTAMP 与 UID 的稳定输入
 * @returns {string} 以 CRLF 分隔的 iCalendar 文本（末尾带换行）
 */
export function buildIcs(events, generatedAt) {
	const list = Array.isArray(events) ? events.filter((e) => e && e.startTs < e.endTs) : [];
	const stamp = utcStamp(generatedAt);
	const lines = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//gacha-calendar-extension//NONSGML gacha-calendar-ics//ZH",
		"CALSCALE:GREGORIAN",
		"METHOD:PUBLISH",
		"X-WR-CALNAME:二游日历"
	];
	for (const e of list) {
		// UID 由调用方给；没给就按 起止 + 标题 推一个稳定值（不随机，避免重复导入）
		const uid = e.uid || fnv1a(`${e.summary}|${e.startTs}|${e.endTs}`) + "@gacha-calendar-extension";
		lines.push("BEGIN:VEVENT");
		lines.push(`UID:${icsEscapeText(uid)}`);
		lines.push(`DTSTAMP:${stamp}`);
		lines.push(`DTSTART:${localStamp(e.startTs)}`);
		lines.push(`DTEND:${localStamp(e.endTs)}`);
		lines.push(`SUMMARY:${icsEscapeText(e.summary)}`);
		if (e.description) lines.push(`DESCRIPTION:${icsEscapeText(e.description)}`);
		lines.push("TRANSP:TRANSPARENT");
		lines.push("END:VEVENT");
	}
	lines.push("END:VCALENDAR");
	return lines.map((l) => icsFold(l)).join(CRLF) + CRLF;
}

/** 导出文件名：`二游日历-YYYY-MM-DD.ics`（用本机日历日）。 */
export function icsFileName(ms) {
	const d = new Date(ms);
	return `二游日历-${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}.ics`;
}
