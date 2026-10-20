import { defineConfig } from "@playwright/test";

const external = process.env.BASE_URL; // preview URL during QA; otherwise serve src/ locally
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.mjs/,
  retries: 0, // never retry until green
  fullyParallel: true,
  reporter: [["list"], ["json", { outputFile: "results.json" }]],
  use: { baseURL: external || "http://127.0.0.1:4173/", browserName: "chromium" },
  webServer: external ? undefined : { command: "node serve.mjs", url: "http://127.0.0.1:4173/", reuseExistingServer: false },
});
