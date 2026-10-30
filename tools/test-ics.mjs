// 日历导出（src/ics.js）的单元测试：不依赖浏览器 / 网络 / 时钟。
// 运行：node tools/test-ics.mjs
import { buildIcs, icsEscapeText, icsFileName, icsFold, localStamp, utcStamp, fnv1a } from "../src/ics.js";

let failed = 0;
function check(name, cond, detail = "") {
	console.log(`  ${cond ? "✓" : "✗"} ${name}${detail && !cond ? "  " + detail : ""}`);
	if (!cond) failed++;
}

console.log("=== 1. 文本转义（RFC 5545）===");
{
	check("分号转义", icsEscapeText("a;b") === "a\\;b", icsEscapeText("a;b"));
	check("逗号转义", icsEscapeText("a,b") === "a\\,b", icsEscapeText("a,b"));
	check("反斜杠转义", icsEscapeText("a\\b") === "a\\\\b", icsEscapeText("a\\b"));
	check("换行转成字面 \\n", icsEscapeText("a\nb") === "a\\nb", icsEscapeText("a\nb"));
	check("CRLF 也只转一个", icsEscapeText("a\r\nb") === "a\\nb", icsEscapeText("a\r\nb"));
	check("null 变空串", icsEscapeText(null) === "");
}

console.log("\n=== 2. 折行：≤75 octet，续行以空格开头，内容可无损还原 ===");
{
	const long = "SUMMARY:" + "原神".repeat(40); // 大量多字节字符
	const folded = icsFold(long);
	const physical = folded.split("\r\n");
	const byteLens = physical.map((l) => Buffer.byteLength(l, "utf8"));
	check("每行 ≤ 75 octet", byteLens.every((n) => n <= 75), byteLens.join(","));
	check("续行都以空格开头", physical.slice(1).every((l) => l.startsWith(" ")));
	check("还原后与原文一致", physical.map((l, i) => (i === 0 ? l : l.slice(1))).join("") === long);
	check("短行不折", icsFold("SUMMARY:abc") === "SUMMARY:abc");
	// 恰好 76 字节的 ASCII：必须折成 75 + 1
	const s = "X".repeat(76);
	const f = icsFold(s).split("\r\n");
	check("76 字节 ASCII 折成 2 行", f.length === 2 && f[0].length === 75 && f[1] === " " + "X");
}

console.log("\n=== 3. 时间戳格式 ===");
{
	const t = Date.UTC(2026, 9, 30, 12, 34, 56); // 2026-10-30T12:34:56Z
	check("utcStamp", utcStamp(t) === "20261030T123456Z", utcStamp(t));
	const local = new Date(2026, 9, 30, 8, 5, 9);
	check("localStamp（本地时间）", localStamp(local.getTime()) === "20261030T080509", localStamp(local.getTime()));
}

console.log("\n=== 4. 生成整份 ICS ===");
{
	const gen = Date.UTC(2026, 9, 30, 1, 2, 3);
	const start = new Date(2026, 9, 13, 18, 0, 0).getTime();
	const end = new Date(2026, 10, 3, 14, 59, 0).getTime();
	const ics = buildIcs(
		[
			{ uid: "abc@gacha", startTs: start, endTs: end, summary: "原神 · 卡池：丝柯克, 爱可菲; 试用", description: "档期：10-13 18:00 ~ 11-03 14:59\nUP：丝柯克" },
			{ startTs: 0, endTs: 0, summary: "无效（起止相同）" },
			{ startTs: end, endTs: start, summary: "无效（倒序）" }
		],
		gen
	);
	const lines = ics.split("\r\n");
	check("用 CRLF 分隔（无裸 LF）", !/[^\r]\n/.test(ics.replace(/\r\n/g, "")) && ics.includes("\r\n"));
	check("以 CRLF 结尾", ics.endsWith("\r\n"));
	check("VCALENDAR 骨架", lines[0] === "BEGIN:VCALENDAR" && lines.includes("END:VCALENDAR"));
	check("版本 2.0", lines.includes("VERSION:2.0"));
	check("DTSTAMP 用 UTC", lines.includes("DTSTAMP:20261030T010203Z"));
	check("DTSTART/DTEND 为浮动本地时间", lines.includes(`DTSTART:${localStamp(start)}`) && lines.includes(`DTEND:${localStamp(end)}`));
	check("只导出有效事件（1 个 VEVENT）", lines.filter((l) => l === "BEGIN:VEVENT").length === 1);
	// 折行会把长行拆开，断言要在"展开折行"后的文本上做
	const unfolded = ics.replace(/\r\n /g, "");
	check("SUMMARY 逗号/分号被转义", unfolded.includes("SUMMARY:原神 · 卡池：丝柯克\\, 爱可菲\\; 试用"), unfolded.slice(0, 200));
	check("DESCRIPTION 换行转字面 \\n", unfolded.includes("DESCRIPTION:档期：10-13 18:00 ~ 11-03 14:59\\nUP：丝柯克"));
	check("事件带稳定 UID", lines.includes("UID:abc@gacha"));
	check("TRANSP:TRANSPARENT（不占用忙碌状态）", lines.includes("TRANSP:TRANSPARENT"));
}

console.log("\n=== 5. 无 uid 时按内容推导稳定 UID（重复导入不产生重复日程）===");
{
	const ev = [{ startTs: 1000, endTs: 2000, summary: "A · 卡池：B" }];
	const a = buildIcs(ev, 1);
	const b = buildIcs(ev, 2);
	const uidOf = (s) => (s.match(/^UID:(.+)$/m) || [])[1];
	check("两次生成 UID 相同", uidOf(a) === uidOf(b), uidOf(a) + " vs " + uidOf(b));
	check("UID 带域名后缀", (uidOf(a) || "").endsWith("@gacha-calendar-extension"));
	check("不同内容 UID 不同", uidOf(buildIcs([{ startTs: 1000, endTs: 3000, summary: "A · 卡池：B" }], 1)) !== uidOf(a));
	check("fnv1a 稳定", fnv1a("hello") === fnv1a("hello") && fnv1a("hello") !== fnv1a("hellp"));
}

console.log("\n=== 6. 文件名 ===");
{
	const d = new Date(2026, 0, 5, 23, 59, 0);
	check("二游日历-YYYY-MM-DD.ics", icsFileName(d.getTime()) === "二游日历-2026-01-05.ics", icsFileName(d.getTime()));
}

console.log("");
if (failed) {
	console.log(`✗ ${failed} 项未通过`);
	process.exit(1);
}
console.log("✓ 日历导出全部用例通过");
