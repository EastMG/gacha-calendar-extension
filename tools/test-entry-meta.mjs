// entry-meta.js 的纯函数测试（无需 DOM）。
//
// 重点验证 `defaultSourceName` 与 core 的 `getDefaultSourceName` **逐支同口径**：
//   1. 有来源标签        → 用标签
//   2. 无标签但有地址    → 用域名（去掉 www.）
//   3. 都没有（未配置）  → 裸「未配置」
// 第 3 支曾写成「默认来源」，是本次要修的 bug；第 2 支原来整个缺失。
import { defaultSourceName, sourceTable } from "../src/entry-meta.js";

let failed = 0;
const check = (name, ok, detail = "") => {
	console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? "  " + detail : ""}`);
	if (!ok) failed++;
};

/** 造一个带 __test.SOURCES 的假引擎。 */
const engineWith = (sources) => ({ __test: { SOURCES: sources } });

console.log("=== 1. 有来源标签 → 用标签 ===");
{
	const src = [{ id: "a", source: "Bwiki 往期祈愿", eventSource: "Bwiki 活动一览", url: "https://wiki.biligame.com/x", eventUrl: "https://wiki.biligame.com/y" }];
	const e = engineWith(src);
	const g = { id: "a" };
	check("卡池侧用 source 标签", defaultSourceName(e, g, false) === "Bwiki 往期祈愿", defaultSourceName(e, g, false));
	check("活动侧用 eventSource 标签", defaultSourceName(e, g, true) === "Bwiki 活动一览", defaultSourceName(e, g, true));
}

console.log("\n=== 2. 无标签但有地址 → 用域名（去 www.）===");
{
	const src = [{ id: "b", url: "https://www.gamekee.com/abc/123", eventUrl: "https://api.example.org/path" }];
	const e = engineWith(src);
	const g = { id: "b" };
	check("卡池侧退到域名并去掉 www.", defaultSourceName(e, g, false) === "gamekee.com", defaultSourceName(e, g, false));
	check("活动侧退到域名", defaultSourceName(e, g, true) === "api.example.org", defaultSourceName(e, g, true));
}

console.log("\n=== 3. 都没有 → 裸「未配置」（本次修复点）===");
{
	const src = [{ id: "c" }];
	const e = engineWith(src);
	const g = { id: "c" };
	check("卡池侧为「未配置」", defaultSourceName(e, g, false) === "未配置", defaultSourceName(e, g, false));
	check("活动侧为「未配置」", defaultSourceName(e, g, true) === "未配置", defaultSourceName(e, g, true));
	// core 侧用户明确要求去掉括号注释，所以文案必须是裸的
	check("不含括号注释（core 2026-10-03 的明确要求）", !defaultSourceName(e, g, false).includes("（"), defaultSourceName(e, g, false));
}

console.log("\n=== 4. 空字符串标签视为无标签 ===");
{
	const src = [{ id: "d", source: "   ", url: "https://fz.wiki/api.php" }];
	const e = engineWith(src);
	check("空白 source 退到域名", defaultSourceName(e, { id: "d" }, false) === "fz.wiki", defaultSourceName(e, { id: "d" }, false));
}

console.log("\n=== 5. listGames() 的结果优先于来源表（自定义条目不在表里）===");
{
	const e = engineWith([{ id: "e", source: "表里的名字", url: "https://a.com/" }]);
	check("listGames 给了 source 就用它", defaultSourceName(e, { id: "e", source: "上游覆盖名" }, false) === "上游覆盖名");
	// 自定义条目不在 __test.SOURCES 里 → 退回"未配置"，不该崩
	check("表里没有该 id 时退化为「未配置」", defaultSourceName(e, { id: "not-in-table" }, false) === "未配置");
}

console.log("\n=== 6. 地址不是合法 URL 时原样返回（与 core 的 catch 分支一致）===");
{
	const e = engineWith([{ id: "f", url: "not-a-url" }]);
	check("非法 URL 原样返回", defaultSourceName(e, { id: "f" }, false) === "not-a-url", defaultSourceName(e, { id: "f" }, false));
}

console.log("\n=== 7. sourceTable 的健壮性与缓存 ===");
{
	check("无 __test 时返回空表", sourceTable({}).size === 0);
	check("__test.SOURCES 非数组时返回空表", sourceTable({ __test: { SOURCES: "nope" } }).size === 0);
	check("null 引擎不抛错", sourceTable(null).size === 0);
	const e = engineWith([{ id: "x" }, { id: "y" }]);
	check("正常取出条目", sourceTable(e).size === 2);
	check("同一引擎返回同一快照（缓存）", sourceTable(e) === sourceTable(e));
	check("缺 id 的条目被忽略", sourceTable(engineWith([{ name: "无 id" }])).size === 0);
}

console.log("");
if (failed) {
	console.log(`✗ ${failed} 项未通过`);
	process.exit(1);
}
console.log("✓ entry-meta 测试全部通过（标签 / 域名兜底 / 未配置 / 容错）");
