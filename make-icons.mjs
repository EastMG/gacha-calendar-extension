// 生成扩展图标（16/32/48/128 PNG）。
//
// 绘制与编码在 tools/icon-art.mjs（商店徽标 300×300 复用同一份代码，保证图形一致）。
// 本文件只负责落盘，产物应当**字节确定**：同样的 Node 版本跑两次得到相同文件。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drawIcon, encodePng } from "./tools/icon-art.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, "src", "icons");

fs.mkdirSync(OUT, { recursive: true });
for (const size of [16, 32, 48, 128]) {
	const png = encodePng(size, size, drawIcon(size));
	const p = path.join(OUT, `icon-${size}.png`);
	fs.writeFileSync(p, png);
	console.log(`写出 src/icons/icon-${size}.png  ${png.length} B`);
}
