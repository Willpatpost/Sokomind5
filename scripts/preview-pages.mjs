import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOST = "127.0.0.1";
const PORT = 4173;
const BASE_PATH = "/Sokomind/";
const DIST = fileURLToPath(new URL("../dist/", import.meta.url));

const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
]);

function resolveRequestPath(url) {
  const pathname = decodeURIComponent(new URL(url, `http://${HOST}`).pathname);
  if (!pathname.startsWith(BASE_PATH)) return null;
  const relative = pathname.slice(BASE_PATH.length) || "index.html";
  const target = path.resolve(DIST, relative);
  const insideDist = path.relative(DIST, target);
  if (insideDist.startsWith("..") || path.isAbsolute(insideDist)) return null;
  return target;
}

const server = createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405).end();
    return;
  }

  const target = resolveRequestPath(request.url ?? "/");
  if (!target) {
    response.writeHead(404).end("Not found");
    return;
  }

  try {
    const details = await stat(target);
    if (!details.isFile()) throw new Error("Not a file");

    response.writeHead(200, {
      "cache-control": "no-store",
      "content-length": details.size,
      "content-type":
        CONTENT_TYPES.get(path.extname(target)) ?? "application/octet-stream",
    });
    if (request.method === "HEAD") {
      response.end();
    } else {
      createReadStream(target).pipe(response);
    }
  } catch {
    response.writeHead(404).end("Not found");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Sokomind preview: http://${HOST}:${PORT}${BASE_PATH}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
