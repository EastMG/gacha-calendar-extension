// 独立校验 release zip：自己解析中央目录、解压每个条目、核对 CRC32。
// 不依赖 PowerShell 的 Expand-Archive（它在受限环境下会因为写进度条失败而解压不出来）。
import fs from "node:fs";
import zlib from "node:zlib";

const zipPath = process.argv[2];
if (!zipPath || !fs.existsSync(zipPath)) {
	console.error("用法: node tools/verify-zip.mjs <路径>");
	process.exit(1);
}
const buf = fs.readFileSync(zipPath);

// 找中央目录结束记录
let eocd = -1;
for (let i = buf.length - 22; i >= 0; i--) {
	if (buf.readUInt32LE(i) === 0x06054b50) {
		eocd = i;
		break;
	}
}
if (eocd < 0) {
	console.error("✗ 找不到 ZIP 结束记录，文件不是合法 zip");
	process.exit(1);
}
const total = buf.readUInt16LE(eocd + 10);
const cdOffset = buf.readUInt32LE(eocd + 16);
console.log(`ZIP: ${zipPath}`);
console.log(`  条目数（中央目录）: ${total}`);
console.log(`  文件大小: ${(buf.length / 1024).toFixed(1)} KB`);

const crcTable = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();
const crc32 = (b) => {
	let c = 0xffffffff;
	for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
};

let p = cdOffset;
let ok = 0;
let bad = 0;
const names = [];
for (let n = 0; n < total; n++) {
	if (buf.readUInt32LE(p) !== 0x02014b50) {
		console.error(`  ✗ 第 ${n + 1} 个中央目录项签名不对`);
		bad++;
		break;
	}
	const method = buf.readUInt16LE(p + 10);
	const crc = buf.readUInt32LE(p + 16);
	const compSize = buf.readUInt32LE(p + 20);
	const rawSize = buf.readUInt32LE(p + 24);
	const nameLen = buf.readUInt16LE(p + 28);
	const extraLen = buf.readUInt16LE(p + 30);
	const commentLen = buf.readUInt16LE(p + 32);
	const localOffset = buf.readUInt32LE(p + 42);
	const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
	names.push(name);

	// 读本地头，定位数据
	const lNameLen = buf.readUInt16LE(localOffset + 26);
	const lExtraLen = buf.readUInt16LE(localOffset + 28);
	const dataStart = localOffset + 30 + lNameLen + lExtraLen;
	const comp = buf.subarray(dataStart, dataStart + compSize);
	let data;
	try {
		data = method === 8 ? zlib.inflateRawSync(comp) : comp;
	} catch (e) {
		console.error(`  ✗ ${name}: 解压失败 ${e.message}`);
		bad++;
		p += 46 + nameLen + extraLen + commentLen;
		continue;
	}
	const crcOk = crc32(data) === crc;
	const sizeOk = data.length === rawSize;
	if (crcOk && sizeOk) {
		ok++;
		console.log(`  ✓ ${name.padEnd(24)} ${String(rawSize).padStart(7)} B  method=${method}  crc 通过`);
	} else {
		bad++;
		console.error(`  ✗ ${name}: CRC ${crcOk ? "通过" : "不匹配"} / 大小 ${sizeOk ? "对" : "不对"}`);
	}
	p += 46 + nameLen + extraLen + commentLen;
}

console.log(`\n解压并校验: ${ok} 通过 / ${bad} 失败`);
if (!names.includes("manifest.json")) {
	console.error("✗ 根目录缺少 manifest.json —— 解压后无法直接加载");
	process.exit(1);
}
console.log("✓ 根目录含 manifest.json（解压后可直接加载）");
if (bad) process.exit(1);
