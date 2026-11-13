import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT_DIR = path.resolve(__dirname, "..");
export const CORE_UI_DIR = path.join(__dirname, "ui");

export const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

export function readJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

export function serveStaticFromDir(
  res: http.ServerResponse,
  baseDir: string,
  relPath: string
): boolean {
  const cleanRel = relPath === "" || relPath === "/" ? "/index.html" : relPath;
  const resolved = path.resolve(baseDir, `.${cleanRel.startsWith("/") ? cleanRel : `/${cleanRel}`}`);
  if (!resolved.startsWith(baseDir)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return true;
  }
  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    const ext = path.extname(resolved);
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    });
    fs.createReadStream(resolved).pipe(res);
    return true;
  }
  return false;
}

export function serveCoreAssetIfMatch(res: http.ServerResponse, pathname: string): boolean {
  if (!pathname.startsWith("/core/")) return false;
  const rel = pathname.slice("/core".length);
  return serveStaticFromDir(res, CORE_UI_DIR, rel);
}
