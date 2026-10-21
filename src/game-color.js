// 每款游戏的代表色 —— **面板与设置页共用同一份实现**。
//
// 为什么单独抽出来：设置页的取色器必须显示"面板里实际在用的颜色"。
// 之前设置页显示的是灰块（虚线表示"默认"），用户根本看不出真实颜色是什么，
// 前后端口径也不一致。抽取后两边调用同一个函数，永远一致。
//
// 取值优先级：
//   1. 用户覆盖（设置页取色器写入 gameColors[游戏id]）
//   2. 条目自带 color（core 的 SOURCES 下发；当前 core 未使用该字段，留作扩展位）
//   3. 按**游戏名哈希**落到固定色盘 —— 同一款永远同色

/** 没有 color 的条目按名字哈希落到这组固定色盘。 */
export const GAME_COLOR_PALETTE = [
	"#E0709F",
	"#3FA9A0",
	"#E0A93B",
	"#4A6CF7",
	"#7A5AF8",
	"#2FB3C9",
	"#E06C4A",
	"#5C9E3F"
];

/** 是否形如 #rrggbb（大小写不敏感）。 */
export function isHexColor(v) {
	return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v.trim());
}

/** 该款游戏的代表色：覆盖 → 条目自带 → 名字哈希。 */
export function gameColor(g, overrides) {
	const id = g && g.id ? String(g.id) : "";
	const ov =
		overrides && id && typeof overrides[id] === "string" ? String(overrides[id]).trim() : "";
	if (isHexColor(ov)) return ov;
	const own = g && typeof g.color === "string" ? g.color.trim() : "";
	if (own) return own;
	const name = String((g && g.name) || "");
	let h = 0;
	for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
	return GAME_COLOR_PALETTE[h % GAME_COLOR_PALETTE.length];
}
