// Builds the static site: copies src/ to dist/.
// The contract (see .github/workflows/ci.yml): `npm run build` writes the site
// to dist/, with dist/index.html. The design may replace this with a bundler.
// Pages serves the site under /factory-sandbox/, so links must be relative.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export function build(root = join(here, "..")) {
  const src = join(root, "src");
  const dist = join(root, "dist");
  if (!existsSync(join(src, "index.html"))) {
    throw new Error("src/index.html is missing");
  }
  rmSync(dist, { recursive: true, force: true });
  cpSync(src, dist, { recursive: true });
  // Leaflet is self-hosted (ADR 0001): copy only the ESM build, CSS and images.
  const leaflet = join(root, "node_modules", "leaflet", "dist");
  if (existsSync(leaflet)) {
    const out = join(dist, "vendor", "leaflet");
    mkdirSync(out, { recursive: true });
    cpSync(join(leaflet, "leaflet-src.esm.js"), join(out, "leaflet-src.esm.js"));
    cpSync(join(leaflet, "leaflet.css"), join(out, "leaflet.css"));
    cpSync(join(leaflet, "images"), join(out, "images"), { recursive: true });
  }
  return dist;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(`Built ${build()}`);
}
