// 校验 release zip：自己解析中央目录、逐条解压、核对 CRC32 与大小，并断言根目录有 manifest.json。
//
// 为什么不依赖 PowerShell 的 Expand-Archive：它在本环境下会因写进度条失败
// （Write-Progress → "Access is denied" 0x5）而解压不出来，容易把好 zip 误判成坏的。
//
// 用法（两种）：
//   CLI：   node tools/verify-zip.mjs <zip 路径>
//   模块：  import { verifyZip } from "./verify-zip.mjs"   // 返回结论，不退出、不打印
//
// 做成模块是为了让 tools/edge-publish.mjs 直接调用：
// 在 Node 里 spawnSync 子进程抓输出会踩到沙箱的命名管道限制（EPERM），
// 而"上传前先自证 zip 合法"这件事不该依赖子进程。
import fs from "node:fs";
import zlib from "node:zlib";

const CRC_TABLE = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();

function crc32(b) {
	let c = 0xffffffff;
	for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

/**
 * 校验一个 zip 文件。
 *
 * @param {string} zipPath
 * @returns {{ok:boolean, total:number, sizeKB:number, hasManifest:boolean,
 *            entries:Array<{name:string,size:number,method:number}>, problems:string[]}}
 */
export function verifyZip(zipPath) {
	const problems = [];
	const entries = [];
	if (!fs.existsSync(zipPath)) {
		return { ok: false, total: 0, sizeKB: 0, hasManifest: false, entries, problems: [`文件不存在: ${zipPath}`] };
	}
	const buf = fs.readFileSync(zipPath);

	// 找中央目录结束记录（EOCD），从尾部往前扫
	let eocd = -1;
	for (let i = buf.length - 22; i >= 0; i--) {
		if (buf.readUInt32LE(i) === 0x06054b50) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) {
		return {
			ok: false,
			total: 0,
			sizeKB: buf.length / 1024,
			hasManifest: false,
			entries,
			problems: ["找不到 ZIP 结束记录，不是合法 zip"]
		};
	}
	const total = buf.readUInt16LE(eocd + 10);
	const cdOffset = buf.readUInt32LE(eocd + 16);

	let p = cdOffset;
	for (let n = 0; n < total; n++) {
		if (buf.readUInt32LE(p) !== 0x02014b50) {
			problems.push(`第 ${n + 1} 个中央目录项签名不对`);
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

		const lNameLen = buf.readUInt16LE(localOffset + 26);
		const lExtraLen = buf.readUInt16LE(localOffset + 28);
		const dataStart = localOffset + 30 + lNameLen + lExtraLen;
		const comp = buf.subarray(dataStart, dataStart + compSize);

		let data;
		try {
			data = method === 8 ? zlib.inflateRawSync(comp) : comp;
		} catch (e) {
			problems.push(`${name}: 解压失败 ${e.message}`);
			p += 46 + nameLen + extraLen + commentLen;
			continue;
		}
		if (crc32(data) !== crc) problems.push(`${name}: CRC 不匹配`);
		else if (data.length !== rawSize) problems.push(`${name}: 大小不符（声明 ${rawSize}，实际 ${data.length}）`);
		else entries.push({ name, size: rawSize, method });

		p += 46 + nameLen + extraLen + commentLen;
	}

	const hasManifest = entries.some((e) => e.name === "manifest.json");
	if (!hasManifest) problems.push("根目录缺少 manifest.json —— 解压后无法直接加载");

	return { ok: problems.length === 0, total, sizeKB: buf.length / 1024, hasManifest, entries, problems };
}

// ---------- CLI ----------
const invokedDirectly = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("tools/verify-zip.mjs");
if (invokedDirectly) {
	const zipPath = process.argv[2];
	if (!zipPath) {
		console.error("用法: node tools/verify-zip.mjs <zip 路径>");
		process.exit(1);
	}
	const r = verifyZip(zipPath);
	console.log(`ZIP: ${zipPath}`);
	console.log(`  条目数: ${r.total}   文件大小: ${r.sizeKB.toFixed(1)} KB`);
	for (const e of r.entries) console.log(`  ✓ ${e.name.padEnd(24)} ${String(e.size).padStart(7)} B  method=${e.method}`);
	for (const pr of r.problems) console.error(`  ✗ ${pr}`);
	if (r.ok) console.log(`\n✓ ${r.entries.length}/${r.total} 条目解压并校验通过${r.hasManifest ? "，根目录含 manifest.json" : ""}`);
	else console.error(`\n✗ zip 校验未通过（${r.problems.length} 个问题）`);
	process.exit(r.ok ? 0 : 1);
}
