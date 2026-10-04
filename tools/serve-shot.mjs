// 临时静态服务：只为让浏览器能打开 _shot/ 夹具（Playwright 禁止 file://）。
// 用完即关，不参与扩展运行。
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "_shot");
const PORT = Number(process.argv[2] || 8899);

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png" };

const server = http.createServer((req, res) => {
	const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
	const rel = urlPath === "/" ? "popup.html" : urlPath.replace(/^\/+/, "");
	const file = path.join(DIR, rel);
	if (!file.startsWith(DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
		res.writeHead(404).end("not found");
		return;
	}
	res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
	fs.createReadStream(file).pipe(res);
});

server.listen(PORT, "127.0.0.1", () => console.log(`shot server: http://127.0.0.1:${PORT}/popup.html`));
