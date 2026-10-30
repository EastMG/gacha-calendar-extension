// 到期提醒纯函数单测（src/remind.js，口径照 DSH 插件）。
// 运行：node tools/test-remind.mjs
import {
	NOTIFY_NAME_DEFAULT,
	REMIND_DEFAULT_END_NODES,
	remindClockOf,
	remindConfigOf,
	remindItemsOf,
	remindNodesOf,
	remindNodesToggleOf,
	remindNodeText,
	remindSpanText,
	remindStateOf,
	remindTestToastOf,
	remindTickOf,
	remindToastOf,
	remindWindowOf,
	remindGamesOf,
	filterRemindGames
} from "../src/remind.js";

let failed = 0;
const check = (name, cond, detail = "") => {
	console.log(`  ${cond ? "✓" : "✗"} ${name}${detail && !cond ? "  " + detail : ""}`);
	if (!cond) failed++;
};

console.log("=== 1. 档位解析 / 胶囊切换 ===");
{
	check("默认串", JSON.stringify(remindNodesOf("72,24,6,2", [1])) === "[72,24,6,2]");
	check("显式空串 = 不提醒（不回落默认）", JSON.stringify(remindNodesOf("", [1])) === "[]");
	check("纯空白也算空串", JSON.stringify(remindNodesOf("   ", [9])) === "[]");
	check("读坏 ⇒ 回落默认", JSON.stringify(remindNodesOf("坏的", [72, 24])) === "[72,24]");
	check("缺键 ⇒ 回落默认", JSON.stringify(remindNodesOf(undefined, [6])) === "[6]");
	check("数组 + 字符串混合、去重、降序", JSON.stringify(remindNodesOf([10, "5", 10], [])) === "[10,5]");
	check("点掉 24", remindNodesToggleOf("72,24,6,2", 24, REMIND_DEFAULT_END_NODES) === "72,6,2");
	check("重新点回 24（保持降序）", remindNodesToggleOf("72,6,2", 24, REMIND_DEFAULT_END_NODES) === "72,24,6,2");
	check("全部点掉 = 空串", remindNodesToggleOf("2", 2, REMIND_DEFAULT_END_NODES) === "");
}

console.log("\n=== 2. 文案口径（与 DSH 逐字一致）===");
{
	check("59 分钟", remindSpanText(59 * 60000) === "59 分", remindSpanText(59 * 60000));
	check("不足 1 分钟补齐成 1 分（与 DSH 的 Math.max(1, mins) 一致）", remindSpanText(30000) === "1 分", remindSpanText(30000));
	check("整 1 小时", remindSpanText(3600000) === "1 小时");
	check("23 小时", remindSpanText(23 * 3600000) === "23 小时");
	check("整 1 天", remindSpanText(24 * 3600000) === "1 天");
	check("2 天 3 小时", remindSpanText((2 * 24 + 3) * 3600000) === "2 天 3 小时", remindSpanText((2 * 24 + 3) * 3600000));
	check("档位按小时说", remindNodeText(24) === "24 小时" && remindNodeText(2) === "2 小时");
	const ts = new Date(2026, 10, 3, 14, 59).getTime();
	check("时钟文本 MM-DD HH:MM", remindClockOf(ts) === "11-03 14:59", remindClockOf(ts));
}

console.log("\n=== 3. 档期解析（本机时区）===");
{
	const now = new Date(2026, 9, 30, 12, 0).getTime();
	const w = remindWindowOf("10-13 18:00 ~ 11-03 14:59", now);
	check("解析出起止", !!w && w.startTs === new Date(2026, 9, 13, 18, 0).getTime() && w.endTs === new Date(2026, 10, 3, 14, 59).getTime());
	check("坏文本 → null", remindWindowOf("未公布", now) === null);
	check("起止倒序 → null", remindWindowOf("12-31 00:00 ~ 01-01 00:00", new Date(2026, 10, 1).getTime())?.endTs > remindWindowOf("12-31 00:00 ~ 01-01 00:00", new Date(2026, 10, 1).getTime())?.startTs);
}

console.log("\n=== 4. 条目派生（remindItemsOf）===");
{
	const now = new Date(2026, 9, 30, 12, 0).getTime();
	const games = {
		genshin: { name: "原神", banner: "丝柯克", bannerDates: "10-13 18:00 ~ 11-03 14:59", event: "活动A", eventDates: "10-01 04:00 ~ 10-20 04:00" },
		hsr: { name: "星铁", banner: "未公布", bannerDates: "" }
	};
	const items = remindItemsOf(games, now);
	check("只派生未结束的方向（原神卡池 + 未开始/未结束的活动）", items.filter((i) => i.gameId === "genshin").length >= 1);
	check("空日期不派生", items.every((i) => i.gameId !== "hsr"));
	check("结束条目带 kind=end 且 T=endTs", items.some((i) => i.kind === "end" && i.T === new Date(2026, 10, 3, 14, 59).getTime()));
	check("去重键格式", items[0].key === `${items[0].gameId}|${items[0].side}|${items[0].kind}|${items[0].T}`, items[0].key);
}

console.log("\n=== 5. 一轮判定（折叠 / 去重 / 清理）===");
{
	const H = 3600000;
	const T = new Date(2026, 10, 3, 14, 59).getTime(); // 固定档期终点
	const item = {
		gameId: "genshin", gameName: "原神", side: "gacha", sideLabel: "卡池", kind: "end",
		title: "丝柯克", T, startTs: new Date(2026, 9, 13, 18, 0).getTime(), endTs: T
	};
	const cfg = { remindEndNodes: "72,24,6,2" };
	const at = (hoursBeforeEnd) => T - hoursBeforeEnd * H; // "现在" = 终点前 N 小时
	const key = item.gameId + "|gacha|end|" + T;

	let r = remindTickOf(at(73), [item], cfg, {});
	check("剩 73 小时：什么都没到（72 档还差 1 小时）", r.toNotify.length === 0 && Object.keys(r.stateNext).length === 0);

	r = remindTickOf(at(71), [item], cfg, {});
	check("剩 71 小时：发 72 档", r.toNotify.length === 1 && r.toNotify[0].node === 72, JSON.stringify(r.toNotify.map((x) => x.node)));
	const state1 = r.stateNext;

	// 中间「错过补跑」：剩 5 小时，72 已发 ⇒ 到期的是 24 与 6，折叠后只发最紧急的 6
	r = remindTickOf(at(5), [item], cfg, state1);
	check("补跑折叠：只发 1 条且 node=6", r.toNotify.length === 1 && r.toNotify[0].node === 6, JSON.stringify(r.toNotify.map((x) => x.node)));
	check("折叠时把 24 也标已发（降序 [72,24,6]）", JSON.stringify(r.stateNext[key].fired) === "[72,24,6]", JSON.stringify(r.stateNext));

	// 剩 1.5 小时：2 档首次到期 → 再发 1 条
	r = remindTickOf(at(1.5), [item], cfg, r.stateNext);
	check("剩 1.5 小时：发 2 档", r.toNotify.length === 1 && r.toNotify[0].node === 2, JSON.stringify(r.toNotify.map((x) => x.node)));
	check("四档累计已发", JSON.stringify(r.stateNext[key].fired) === "[72,24,6,2]", JSON.stringify(r.stateNext[key].fired));

	// 同一档期已全部发过 ⇒ 不再打扰
	r = remindTickOf(at(1), [item], cfg, r.stateNext);
	check("四档全发过后不再重复", r.toNotify.length === 0);

	// 已过期键清理
	const stale = { "genshin|gacha|end|1": { fired: [72] } };
	r = remindTickOf(at(1), [], cfg, stale);
	check("T 已过的键被清掉", Object.keys(r.stateNext).length === 0, JSON.stringify(r.stateNext));

	// 空档位（用户全点掉）⇒ 不提醒
	r = remindTickOf(at(5), [item], { remindEndNodes: "" }, {});
	check("档位全空 ⇒ 不提醒", r.toNotify.length === 0);

	// 坏数据：T 已过
	r = remindTickOf(at(1), [{ gameId: "x", side: "gacha", kind: "end", T: at(1) - 1 }], cfg, {});
	check("T 已过 ⇒ 整条作废", r.toNotify.length === 0 && Object.keys(r.stateNext).length === 0);
}

console.log("\n=== 6. 通知文案（remindToastOf）===");
{
	const now = new Date(2026, 9, 30, 12, 0).getTime();
	const H = 3600000;
	const notify = {
		gameName: "原神",
		sideLabel: "卡池",
		title: "「虚星临渡」107期角色活动祈愿",
		kind: "end",
		node: 24,
		T: now + (2 * 24 + 3) * H,
		startTs: new Date(2026, 9, 13, 18, 0).getTime(),
		endTs: now + (2 * 24 + 3) * H
	};
	const toast = remindToastOf(notify, now, "二游日历");
	check("标题：即将结束 · 原神", toast.title === "即将结束 · 原神", toast.title);
	check("首行：卡池「…」", toast.lines[0] === "卡池「「虚星临渡」107期角色活动祈愿」", toast.lines[0]);
	check("第二行：起止 + 结束", toast.lines[1] === "10-13 18:00 → 11-01 15:00 结束", toast.lines[1]);
	check("第三行：还剩 X（24 小时提醒）", toast.lines[2] === "还剩 2 天 3 小时（24 小时提醒）", toast.lines[2]);

	const startToast = remindToastOf({ ...notify, kind: "start" }, now, "二游日历");
	check("开始方向标题", startToast.title === "即将开始 · 原神");
	check("开始方向用「还有」", startToast.lines[2].startsWith("还有 "));

	const noNode = remindToastOf({ ...notify, node: null }, now, "二游日历");
	check("无档位 ⇒ 到点提醒", noNode.lines[2] === "还剩 2 天 3 小时（到点提醒）", noNode.lines[2]);
}

console.log("\n=== 7. 测试通知文案（remindTestToastOf）===");
{
	const now = new Date(2026, 9, 30, 12, 34, 56).getTime();
	const toast = remindTestToastOf(now, "二游日历");
	check("标题带应用名", toast.title === "二游日历 · 通知测试", toast.title);
	check("发送者行", toast.lines[0] === "发送者：二游日历", toast.lines[0]);
	check("通道行", toast.lines[1].includes("系统通知"), toast.lines[1]);
	check("时间精确到秒", toast.lines[2] === "时间：2026-10-30 12:34:56", toast.lines[2]);
	check("说明行", toast.lines[3].includes("系统通知链路是通的"), toast.lines[3]);
	check("空应用名回落默认", remindTestToastOf(now, "  ").lines[0] === "发送者：" + NOTIFY_NAME_DEFAULT);
}

console.log("\n=== 8. 逐游戏白名单（remindGames）===");
{
	const games = { genshin: { name: "原神" }, hsr: { name: "星铁" }, zzz: { name: "绝区零" } };
	check("键缺失 ⇒ 不限制（全部）", Object.keys(filterRemindGames(games, undefined)).length === 3);
	check("坏值（字符串）⇒ 不限制", Object.keys(filterRemindGames(games, "genshin")).length === 3);
	check("列表只留命中的", JSON.stringify(Object.keys(filterRemindGames(games, ["genshin", "zzz"]))) === '["genshin","zzz"]');
	check("空数组 ⇒ 一个都不提醒", Object.keys(filterRemindGames(games, [])).length === 0);
	check("列表里不存在的 id 不影响结果", Object.keys(filterRemindGames(games, ["nope"])).length === 0);
	check("数字 id 也按字符串比较", remindGamesOf([1, "2"]).has("1") && remindGamesOf([1, "2"]).has("2"));
}

console.log("\n=== 8. 状态归一（remindStateOf）===");
{
	const s = remindStateOf({
		"genshin|gacha|end|1793113200000": { fired: [72, 24, 24] },
		"bad key": { fired: [1] },
		"x|gacha|end|123": { fired: [] },
		"y|gacha|end|456": "垃圾"
	});
	check("只留合法键 + 去重降序", JSON.stringify(s) === '{"genshin|gacha|end|1793113200000":{"fired":[72,24]}}', JSON.stringify(s));
	check("配置读坏回落默认", JSON.stringify(remindConfigOf("坏").endNodes) === "[72,24,6,2]");
	check("开始档位保持为空（与 DSH 一致）", JSON.stringify(remindConfigOf({ remindStartNodes: "24,2" }).startNodes) === "[]");
}

console.log("");
if (failed) {
	console.log(`✗ ${failed} 项未通过`);
	process.exit(1);
}
console.log("✓ 到期提醒全部用例通过");
