// storage 适配层：把 chrome.storage.local 包装成 core 需要的 { get(key), set(key, value) }。
//
// core 会读写的键（见 gacha-calendar-core 的 README）：
//   配置：order / hidden / removed / customEntries / customUrls / customEventUrls
//         autoRefresh / refreshMinutes
//   缓存：lastData / lastRefresh / lastSource
//
// 注意：值一律按 JS 原生值直接存（**不要 JSON.stringify 两次**）——
// core 自己已经对 lastData 做了 JSON 字符串化。

/** @returns {{get:(k:string)=>Promise<any>, set:(k:string,v:any)=>Promise<void>}} */
export function createStorage() {
	const area = chrome.storage.local;
	return {
		async get(key) {
			const obj = await area.get(key);
			return obj ? obj[key] : undefined;
		},
		async set(key, value) {
			// undefined 不能进 chrome.storage（会被丢掉）→ 存 null 明确表示"清空"
			await area.set({ [key]: value === undefined ? null : value });
		}
	};
}

/** 直接读一个键（供 UI 自己读配置用，键名与 core 一致）。 */
export async function readKeys(keys) {
	const obj = await chrome.storage.local.get(keys);
	return obj || {};
}

/** 直接写多个键（供设置页保存用）。 */
export async function writeKeys(patch) {
	await chrome.storage.local.set(patch);
}
