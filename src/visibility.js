// 条目可见性：正确复现 core 的 `isEntryHidden` 语义。
//
// 为什么需要这个模块（core 0.11.x 引入 `defaultHidden` 后的缺口）：
//   core 有 5 个条目**出厂默认隐藏**（崩坏3 / OurNotes 日服·国际服 / 卡厄斯梦境 / 嘟嘟脸恶作剧），
//   判定规则是「`hidden` 里有 → 隐；`defaultHidden` 且 `shown` 里没有 → 隐；否则显」。
//   但 `listGames()` 返回的 `hidden` 字段**只算了 `hidden` 数组**，也没暴露 `defaultHidden`。
//   若 UI 直接信这个字段，那 5 个条目会被错误地显示出来（且勾选状态也是错的）。
//
// `defaultHidden` 从 core 的运行时来源表读取（见 entry-meta.js），
// 再结合 storage 里的 `hidden` / `shown` 自行判定，与 core 口径保持一致。

import { sourceTable } from "./entry-meta.js";

/**
 * 计算每个条目的隐藏状态与勾选状态。
 *
 * @param {{__test?: object}} engine
 * @param {{hidden?: string[], shown?: string[]}} settings
 * @returns {{isHidden: (id: string) => boolean, isChecked: (id: string) => boolean}}
 */
export function createVisibility(engine, settings) {
	const table = sourceTable(engine);
	const hidden = Array.isArray(settings && settings.hidden) ? settings.hidden : [];
	const shown = Array.isArray(settings && settings.shown) ? settings.shown : [];

	/** 出厂默认隐藏？ */
	const isDefaultHidden = (id) => {
		const meta = table.get(id);
		return !!(meta && meta.defaultHidden);
	};

	const isHidden = (id) => {
		if (hidden.includes(id)) return true;
		if (!isDefaultHidden(id)) return false;
		return !shown.includes(id);
	};

	return {
		isHidden,
		// 设置页的勾选态 = 「当前是否可见」，而不是 hidden 数组的字面成员
		isChecked: (id) => !isHidden(id)
	};
}

/**
 * 把某个条目切到「显示 / 隐藏」，返回需要写入 storage 的补丁。
 *
 * 三种状态要分清（这正是 core 用两个键的原因）：
 *   - 普通条目「隐藏」→ 加入 hidden
 *   - 普通条目「显示」→ 移出 hidden
 *   - 默认隐藏条目「显示」→ 加入 shown（**不能只移出 hidden**，否则它仍然是隐的）
 *   - 默认隐藏条目「隐藏」→ 移出 shown，并加入 hidden
 *
 * @param {{__test?: object}} engine
 * @param {{hidden?: string[], shown?: string[]}} settings
 * @param {string} id
 * @param {boolean} visible 目标状态：true=显示
 * @returns {{hidden: string[], shown: string[]}}
 */
export function toggleVisibility(engine, settings, id, visible) {
	const table = sourceTable(engine);
	const isDefaultHidden = !!(table.get(id) && table.get(id).defaultHidden);
	const hidden = new Set(Array.isArray(settings && settings.hidden) ? settings.hidden : []);
	const shown = new Set(Array.isArray(settings && settings.shown) ? settings.shown : []);

	if (visible) {
		hidden.delete(id);
		if (isDefaultHidden) shown.add(id);
	} else {
		shown.delete(id);
		hidden.add(id);
	}
	return { hidden: [...hidden], shown: [...shown] };
}
