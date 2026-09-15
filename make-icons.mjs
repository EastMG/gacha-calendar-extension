// 生成扩展图标（16/32/48/128 PNG）。
//
// 为什么自己写：本机沙箱下不引入图像库、不依赖 sharp，用 Node 内置 zlib 直接编码 PNG 即可，
// 保证 `npm install` 之后任何人 `node make-icons.mjs` 都能复现同一套图标（字节确定）。
//
// 图形：圆角方块底 + 日历外形（顶部装订条 + 网格点），与 DSH 插件侧边栏用的线框日历同义。

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, "src", "icons");

// —— 配色（跟随 4 倍超采样抗锯齿，看起来干净）——
const BG = [37, 99, 235];      // 蓝色底
const FG = [255, 255, 255];    // 白色日历

const SS = 4; // 超采样倍数

/** 生成一张 size×size 的 RGBA 图（内部按 SS 倍绘制再降采样）。 */
function drawIcon(size) {
	const big = size * SS;
	const buf = new Uint8Array(big * big * 4); // RGBA

	const set = (x, y, [r, g, b]) => {
		const i = (y * big + x) * 4;
		buf[i] = r;
		buf[i + 1] = g;
		buf[i + 2] = b;
		buf[i + 3] = 255;
	};

	// 圆角方块底：半径 = 22% 边长
	const R = big * 0.22;
	const inRounded = (x, y) => {
		const cx = Math.min(Math.max(x, R), big - 1 - R);
		const cy = Math.min(Math.max(y, R), big - 1 - R);
		const dx = x - cx;
		const dy = y - cy;
		return dx * dx + dy * dy <= R * R;
	};
	for (let y = 0; y < big; y++) {
		for (let x = 0; x < big; x++) {
			if (inRounded(x, y)) set(x, y, BG);
		}
	}

	// 日历外形（在方块内居中，占比 62%）
	const m = big * 0.19;            // 边距
	const w = big - m * 2;           // 日历宽
	const h = w * 0.9;               // 日历高
	const top = (big - h) / 2;
	const bar = Math.max(SS, big * 0.085);   // 顶部装订条高度
	const stroke = Math.max(SS, big * 0.055); // 线宽

	const fillRect = (x0, y0, x1, y1) => {
		for (let y = Math.max(0, Math.round(y0)); y < Math.min(big, Math.round(y1)); y++) {
			for (let x = Math.max(0, Math.round(x0)); x < Math.min(big, Math.round(x1)); x++) set(x, y, FG);
		}
	};

	// 外框（四条边）
	const L = m, T = top, Rt = m + w, B = top + h;
	fillRect(L, T, Rt, T + stroke);            // 上
	fillRect(L, B - stroke, Rt, B);            // 下
	fillRect(L, T, L + stroke, B);             // 左
	fillRect(Rt - stroke, T, Rt, B);           // 右
	// 顶部装订条（实心）
	fillRect(L, T, Rt, T + bar);
	// 两个装订环（伸出上沿）
	const ringW = stroke * 1.15;
	fillRect(L + w * 0.24, T - bar * 0.55, L + w * 0.24 + ringW, T + bar * 0.5);
	fillRect(L + w * 0.76 - ringW, T - bar * 0.55, L + w * 0.76, T + bar * 0.5);
	// 网格点（2 行 3 列），落在装订条下方
	const gx0 = L + w * 0.26, gx1 = L + w * 0.74;
	const gy0 = T + bar + (B - (T + bar)) * 0.3, gy1 = T + bar + (B - (T + bar)) * 0.68;
	const dot = Math.max(SS * 1.2, big * 0.055);
	for (const gy of [gy0, gy1]) {
		for (const gx of [gx0, (gx0 + gx1) / 2, gx1]) fillRect(gx - dot / 2, gy - dot / 2, gx + dot / 2, gy + dot / 2);
	}

	// 降采样 SS×SS → 平均
	const out = Buffer.alloc(size * size * 4);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			let r = 0, g = 0, b = 0, a = 0;
			for (let dy = 0; dy < SS; dy++) {
				for (let dx = 0; dx < SS; dx++) {
					const i = ((y * SS + dy) * big + (x * SS + dx)) * 4;
					r += buf[i]; g += buf[i + 1]; b += buf[i + 2]; a += buf[i + 3];
				}
			}
			const n = SS * SS;
			const o = (y * size + x) * 4;
			out[o] = Math.round(r / n);
			out[o + 1] = Math.round(g / n);
			out[o + 2] = Math.round(b / n);
			out[o + 3] = Math.round(a / n);
		}
	}
	return out;
}

// —— 最小 PNG 编码器（RGBA、无滤波）——
function crc32(buf) {
	let c;
	const table = crc32.table || (crc32.table = (() => {
		const t = new Uint32Array(256);
		for (let n = 0; n < 256; n++) {
			c = n;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			t[n] = c >>> 0;
		}
		return t;
	})());
	let crc = 0xffffffff;
	for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length, 0);
	const typeBuf = Buffer.from(type, "ascii");
	const body = Buffer.concat([typeBuf, data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body), 0);
	return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr[8] = 8;   // bit depth
	ihdr[9] = 6;   // color type: RGBA
	ihdr[10] = 0;  // compression
	ihdr[11] = 0;  // filter
	ihdr[12] = 0;  // interlace

	// 每行前面加一个 filter byte（0 = None）
	const raw = Buffer.alloc((size * 4 + 1) * size);
	for (let y = 0; y < size; y++) {
		raw[y * (size * 4 + 1)] = 0;
		rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", ihdr),
		chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
		chunk("IEND", Buffer.alloc(0))
	]);
}

fs.mkdirSync(OUT, { recursive: true });
for (const size of [16, 32, 48, 128]) {
	const png = encodePng(size, drawIcon(size));
	const p = path.join(OUT, `icon-${size}.png`);
	fs.writeFileSync(p, png);
	console.log(`写出 src/icons/icon-${size}.png  ${png.length} B`);
}
