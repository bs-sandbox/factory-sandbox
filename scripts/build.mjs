// Builds the static site: copies src/ to dist/.
// The contract (see .github/workflows/ci.yml): `npm run build` writes the site
// to dist/, with dist/index.html. The design may replace this with a bundler.
// Pages serves the site under /factory-sandbox/, so links must be relative.
import { cpSync, existsSync, rmSync } from "node:fs";
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
  return dist;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(`Built ${build()}`);
}
