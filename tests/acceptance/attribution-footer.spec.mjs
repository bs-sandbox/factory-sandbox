// LIV-41 acceptance tests: data-source attribution footer on the main page.
// Source of truth: the LIV-41 Acceptance Criteria (scenarios S1-S7). DOM hooks and
// literal strings: contracts/ui/attribution-footer.md v1.0.0 (ADR 0007, PR #15).
// Each test is independent: it creates its own browser context and touches no
// persistent state. No external network is used: target hosts are stubbed.
import { expect, test } from "@playwright/test";

const FOOTER_TEXT = "Weather data: Open-Meteo · Map: © OpenStreetMap contributors";
const OPEN_METEO_URL = "https://open-meteo.com/";
const OSM_URL = "https://www.openstreetmap.org/";

// The footer block as the contract places it (used only to build the S6 baseline).
const FOOTER_BLOCK = /<footer\b[^>]*data-testid="attribution-footer"[\s\S]*?<\/footer>/;

const STUB_HTML = "<!doctype html><title>stub</title>";

// Block every non-local host, then answer the two link targets with a stub page.
// Playwright matches the most recently registered route first, so the stubs win.
async function installStubs(context) {
  await context.route(
    (url) => url.hostname !== "127.0.0.1",
    (route) => route.abort(),
  );
  for (const host of ["open-meteo.com", "www.openstreetmap.org"]) {
    await context.route(
      (url) => url.hostname === host,
      (route) => route.fulfill({ status: 200, contentType: "text/html", body: STUB_HTML }),
    );
  }
}

async function openMainPage(page) {
  await page.goto("/");
  await page.waitForLoadState("load");
}

test.beforeEach(async ({ context }) => {
  await installStubs(context);
});

test("S1 footer text is shown at the bottom of the main page", async ({ page }) => {
  await openMainPage(page);
  await expect(page.getByTestId("attribution-footer")).toBeVisible();
  const text = await page.getByTestId("attribution-text").textContent();
  expect(text).toBe(FOOTER_TEXT);
});

test("S2 'Open-Meteo' links to its site", async ({ page, context }) => {
  const navigations = [];
  context.on("request", (req) => {
    if (req.isNavigationRequest()) navigations.push(req.url());
  });
  await openMainPage(page);
  await page
    .getByTestId("attribution-footer")
    .getByRole("link", { name: "Open-Meteo", exact: true })
    .click();
  await expect.poll(() => navigations).toContain(OPEN_METEO_URL);
});

test("S3 'OpenStreetMap contributors' links to its site", async ({ page, context }) => {
  const navigations = [];
  context.on("request", (req) => {
    if (req.isNavigationRequest()) navigations.push(req.url());
  });
  await openMainPage(page);
  await page
    .getByTestId("attribution-footer")
    .getByRole("link", { name: "OpenStreetMap contributors", exact: true })
    .click();
  await expect.poll(() => navigations).toContain(OSM_URL);
});

test("S4 footer is the last visible element on the page", async ({ page }) => {
  await openMainPage(page);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const layout = await page.evaluate(() => {
    const describe = (el) => {
      const id = el.id ? `#${el.id}` : "";
      const tid = el.getAttribute("data-testid");
      return `${el.tagName.toLowerCase()}${id}${tid ? `[data-testid="${tid}"]` : ""}`;
    };
    const footer = document.querySelector('[data-testid="attribution-footer"]');
    if (!footer) return { footerFound: false };
    const notRendered = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "LINK", "META", "TITLE"]);
    const visible = [...document.body.querySelectorAll("*")].filter((el) => {
      if (notRendered.has(el.tagName)) return false;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return false;
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    });
    const footerBox = footer.getBoundingClientRect();
    const others = visible.filter((el) => !footer.contains(el));
    // Other visible elements that come after the footer in document order.
    const followingElements = others
      .filter((el) => footer.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
      .map(describe);
    // Other visible elements that reach down to or past the footer's top edge.
    const overlapping = others
      .filter((el) => el.getBoundingClientRect().bottom > footerBox.top + 0.5)
      .map(describe);
    return {
      footerFound: true,
      footerVisible: visible.includes(footer),
      followingElements,
      overlapping,
    };
  });
  expect(layout.footerFound, "attribution footer present").toBe(true);
  expect(layout.footerVisible, "attribution footer visible").toBe(true);
  expect(layout.followingElements, "visible elements after the footer").toEqual([]);
  expect(layout.overlapping, "visible elements at or below the footer top").toEqual([]);
});

test.describe("S5 visitors", () => {
  test("S5 footer is shown to a new visitor who has not signed in", async ({ page }) => {
    // A fresh context has no cookies, storage or session: the visitor is not signed in.
    await openMainPage(page);
    await expect(page.getByTestId("attribution-footer")).toBeVisible();
  });

  test.describe("with JavaScript disabled", () => {
    test.use({ javaScriptEnabled: false });

    test("S5 footer is shown to a visitor whose browser runs no JavaScript", async ({ page }) => {
      await openMainPage(page);
      await expect(page.getByTestId("attribution-footer")).toBeVisible();
    });
  });
});

// Loads the main page in a fresh context and returns every host the page requested.
// With stripFooter, the same page is served with the footer block removed from the
// HTML response: this is the pre-change baseline (see the S6 note below).
async function collectHosts(browser, { stripFooter }) {
  const context = await browser.newContext();
  await installStubs(context);
  const hosts = new Set();
  context.on("request", (req) => hosts.add(new URL(req.url()).host));
  const page = await context.newPage();
  if (stripFooter) {
    await page.route(
      (url) => url.pathname === "/",
      async (route) => {
        const response = await route.fetch();
        const headers = { ...response.headers() };
        delete headers["content-length"];
        const html = (await response.text()).replace(FOOTER_BLOCK, "");
        await route.fulfill({ status: response.status(), headers, body: html });
      },
    );
  }
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const footerCount = await page.getByTestId("attribution-footer").count();
  await context.close();
  return { hosts: [...hosts].sort(), footerCount };
}

test("S6 the footer makes no request to a host the baseline does not contact", async ({ browser }) => {
  // PROVISIONAL BASELINE: the pre-change page is simulated in the same run by removing the
  // footer block from the served HTML. A stored baseline from LIV-43 may replace this; see
  // the QA question on LIV-41.
  const baseline = await collectHosts(browser, { stripFooter: true });
  const current = await collectHosts(browser, { stripFooter: false });
  expect(baseline.footerCount, "baseline run must have no footer").toBe(0);
  expect(current.footerCount, "current run must have the footer").toBe(1);
  const added = current.hosts.filter((host) => !baseline.hosts.includes(host));
  expect(added, "hosts requested with the footer but not in the baseline").toEqual([]);
});

test("S7 footer text is not editable by visitors", async ({ page }) => {
  await openMainPage(page);
  const text = page.getByTestId("attribution-text");
  const before = await text.textContent();
  expect(before).toBe(FOOTER_TEXT);
  await text.click({ position: { x: 2, y: 2 } });
  await page.keyboard.press("Control+A");
  await page.keyboard.type("EDITED");
  const after = await text.textContent();
  expect(after).toBe(before);
});
