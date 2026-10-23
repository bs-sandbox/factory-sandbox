// Minimal static server for src/ (used only when BASE_URL is not set).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../src/", import.meta.url));
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css" };
const port = Number(process.env.PORT || 4173);

createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  const rel = normalize(path === "/" ? "/index.html" : path).replace(/^[\\/]+/, "");
  if (rel.startsWith("..")) { res.writeHead(400).end(); return; }
  try {
    const body = await readFile(join(root, rel));
    res.writeHead(200, { "content-type": types[extname(rel)] || "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, "127.0.0.1");
