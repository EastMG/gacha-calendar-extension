// 条目元信息：统一从 core 的运行时来源表读取「界面上看不到、但判定需要」的字段。
//
// 为什么需要这个模块：
//   core 的 `listGames()` 只返回 UI 直接用得到的字段（name / source / eventSource / icon…），
//   但**判定类**字段没有暴露：
//     · `defaultHidden` —— 出厂默认隐藏（判定见 visibility.js）
//     · `url` / `eventUrl` —— 来源显示名的兜底依据（见 defaultSourceName）
//   这些字段在 core 的 `__test.SOURCES` 上是全的。
//
// 集中在这里读取的理由：`__test` 是 core 的内部字段，万一将来改名/消失，
// 只需要改这一个文件；且只在这里做一次快照，避免多处各读一遍而互相漂移。

const TABLES = new WeakMap();

/**
 * 取某个引擎的内置来源表快照：`Map<id, 来源元信息>`。
 *
 * 结果按引擎缓存（`__test.SOURCES` 是构建期常量，不会变）。
 * 取不到时返回空表 —— 调用方据此退化为"没有元信息"的旧行为，而不是崩掉。
 *
 * @param {{__test?: {SOURCES?: unknown}}} engine
 * @returns {Map<string, Record<string, unknown>>}
 */
export function sourceTable(engine) {
	if (engine && typeof engine === "object" && TABLES.has(engine)) return TABLES.get(engine);
	const map = new Map();
	try {
		const sources = engine && engine.__test && engine.__test.SOURCES;
		if (Array.isArray(sources)) {
			for (const s of sources) {
				if (s && typeof s.id === "string") map.set(s.id, s);
			}
		}
	} catch {
		/* 取不到就用空表 */
	}
	if (engine && typeof engine === "object") TABLES.set(engine, map);
	return map;
}

/**
 * 「默认来源」显示名 —— 与 core 的 `getDefaultSourceName` **逐支保持同口径**：
 *
 *   1. 该侧有来源标签（卡池 `source` / 活动 `eventSource`）→ 用标签
 *   2. 否则该侧有地址（`url` / `eventUrl`）              → 用域名（去掉 `www.`）
 *   3. 都没有（该侧压根没配来源）                        → `"未配置"`
 *
 * 第 3 支的文案必须是**裸「未配置」**：core 那边用户 2026-10-03 明确要求去掉
 * 「（不抓取卡池/活动）」这类括号注释（下拉列窄，括号喧宾夺主）。
 *
 * @param {{__test?: object}} engine
 * @param {{id?: string, source?: string, eventSource?: string}} game 来自 listGames()
 * @param {boolean} isEvent 取活动侧则为 true
 * @returns {string}
 */
export function defaultSourceName(engine, game, isEvent) {
	const full = sourceTable(engine).get(game && game.id) || {};
	const label = isEvent ? game && game.eventSource : game && game.source;
	const text = label && String(label).trim() !== "" ? label : isEvent ? full.eventSource : full.source;
	if (text && String(text).trim() !== "") return String(text).trim();

	const url = isEvent ? full.eventUrl : full.url;
	if (url && String(url).trim() !== "") {
		const raw = String(url).trim();
		try {
			return new URL(raw).hostname.replace(/^www\./, "");
		} catch {
			return raw;
		}
	}
	return "未配置";
}
