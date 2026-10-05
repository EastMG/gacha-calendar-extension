// 临时静态服务：只为让浏览器能打开离线渲染夹具 / 预览隐私政策页（Playwright 禁止 file://）。
// 用完即关，不参与扩展运行。
//
// 服务的目录：_lab/（由 tools/make-store-assets.mjs 生成）、docs/、store/、src/icons/。
// 注意：夹具页面会引用 ../src/icons/icon-128.png，所以这些路径都要放开。
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.argv[2] || 8899);

/** 允许访问的路径前缀（防目录穿越；只放开夹具、图标与商店/文档页面）。 */
const ALLOW_PREFIX = [
	path.join(ROOT, "_lab"),
	path.join(ROOT, "src", "icons"),
	path.join(ROOT, "docs"),
	path.join(ROOT, "store")
];

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png" };

const server = http.createServer((req, res) => {
	const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
	// 默认进 _lab；也允许直接写 /_lab/xxx 或 /src/icons/xxx
	const rel = urlPath === "/" ? "_lab/popup.html" : urlPath.replace(/^\/+/, "");
	const file = path.resolve(ROOT, rel);
	if (!ALLOW_PREFIX.some((p) => file === p || file.startsWith(p + path.sep))) {
		res.writeHead(403).end("forbidden");
		return;
	}
	if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
		res.writeHead(404).end("not found");
		return;
	}
	res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
	fs.createReadStream(file).pipe(res);
});

server.listen(PORT, "127.0.0.1", () => console.log(`shot server: http://127.0.0.1:${PORT}/popup.html`));
