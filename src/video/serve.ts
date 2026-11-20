import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat, realpath } from "node:fs/promises";
import path from "node:path";

/** Loopback-only player with byte ranges, including seeks beyond buffered media. */
export async function serveVideo(directory: string, port = 8058) {
  const root = await realpath(directory);
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".mp4": "video/mp4",
    ".vtt": "text/vtt",
    ".png": "image/png",
    ".json": "application/json",
    ".md": "text/plain; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".js": "text/javascript",
    ".css": "text/css",
  };
  const server = createServer(async (req, res) => {
    try {
      if (!["GET", "HEAD"].includes(req.method ?? "")) {
        res.writeHead(405).end();
        return;
      }
      const name = decodeURIComponent(
        new URL(req.url ?? "/", "http://localhost").pathname,
      );
      const file = await realpath(
        path.join(root, name === "/" ? "player.html" : name),
      );
      if (!file.startsWith(root + path.sep)) {
        res.writeHead(403).end();
        return;
      }
      const info = await stat(file);
      if (!info.isFile()) {
        res.writeHead(404).end();
        return;
      }
      let start = 0,
        end = info.size - 1,
        status = 200;
      const headers: Record<string, string | number> = {
        "Content-Type": types[path.extname(file)] ?? "application/octet-stream",
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      };
      if (req.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if (!match || (!match[1] && !match[2])) {
          res.writeHead(416, { "Content-Range": `bytes */${info.size}` }).end();
          return;
        }
        start = match[1]
          ? Number(match[1])
          : Math.max(0, info.size - Number(match[2]));
        end =
          match[1] && match[2]
            ? Math.min(Number(match[2]), info.size - 1)
            : info.size - 1;
        if (start > end || start >= info.size) {
          res.writeHead(416, { "Content-Range": `bytes */${info.size}` }).end();
          return;
        }
        status = 206;
        headers["Content-Range"] = `bytes ${start}-${end}/${info.size}`;
      }
      headers["Content-Length"] = Math.max(0, end - start + 1);
      res.writeHead(status, headers);
      if (req.method === "HEAD" || info.size === 0) {
        res.end();
        return;
      }
      const stream = createReadStream(file, { start, end });
      stream.on("error", () => res.destroy());
      res.on("close", () => stream.destroy());
      stream.pipe(res);
    } catch {
      if (!res.headersSent) res.writeHead(404).end();
      else res.destroy();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server;
}
