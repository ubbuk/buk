import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { AUTH_DIR } from "./global-setup";
import { smallTargets } from "./helpers";

// Phone-width sweep across many device widths (iPhone SE 320/375, Galaxy 360/412, Xiaomi/Redmi 393/400,
// iPhone 12-16 390/393/428/440, in-between 344/480/600). For every page it checks, besides page-level
// overflow: elements sticking out of the viewport, text that is CLIPPED without an ellipsis (information
// lost), and (reported) touch targets under 44px. Read-only; nothing is submitted.
const WIDTHS = [320, 344, 360, 375, 390, 393, 412, 428, 440, 480, 600];
const STATIC_PAGES = [
  "/dashboard", "/requests", "/requests/new", "/approvals", "/warehouses", "/archive", "/reports",
  "/settings", "/procurement", "/accounting", "/admin", "/admin/audit", "/admin/monitoring", "/admin/monitoring/time-machine",
];
const OUT = path.join(__dirname, "results-smoke");

async function scan(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const sel = (el: Element) => {
      const c = typeof (el as HTMLElement).className === "string" ? (el as HTMLElement).className.trim().split(/\s+/).slice(0, 3).join(".") : "";
      return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${c ? "." + c : ""}`;
    };
    const insideScroller = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === "auto" || ox === "scroll") return true;
      }
      return false;
    };
    const out: string[] = [];
    const clipped: string[] = [];
    const ellipsized: string[] = [];
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      if (el.closest("svg") && el.tagName.toLowerCase() !== "svg") continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if ((r.right > vw + 1 || r.left < -1) && !insideScroller(el) && cs.opacity !== "0") out.push(`${sel(el)} ${Math.round(r.left)}→${Math.round(r.right)}`);
      if (cs.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1 && (el.textContent ?? "").trim().length > 0) {
        ellipsized.push(`${sel(el)} "${(el.textContent ?? "").trim().slice(0, 28)}"`);
      }
      const ox = cs.overflowX;
      if ((ox === "hidden" || ox === "clip") && el.scrollWidth > el.clientWidth + 2 && cs.textOverflow !== "ellipsis" && (el.textContent ?? "").trim().length > 0 && !el.closest(".sr-only")) {
        const lc = (cs as unknown as Record<string, string>)["webkitLineClamp"];
        if (!lc || lc === "none") clipped.push(`${sel(el)} "${(el.textContent ?? "").trim().slice(0, 30)}" ${el.clientWidth}<${el.scrollWidth}`);
      }
    }
    return { sw: document.documentElement.scrollWidth, vw, out: out.slice(0, 8), clipped: clipped.slice(0, 8), ellipsized: ellipsized.slice(0, 12) };
  });
}

for (const w of WIDTHS) {
  test(`sweep @${w}`, async ({ browser }) => {
    test.setTimeout(420_000);
    fs.mkdirSync(OUT, { recursive: true });
    const failures: string[] = [];
    const notes: string[] = [];

    // login page (unauthenticated)
    {
      const ctx = await browser.newContext({ viewport: { width: w, height: 800 } });
      const page = await ctx.newPage();
      await page.goto("/login", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(600);
      const r = await scan(page);
      if (r.sw > r.vw || r.out.length || r.clipped.length) failures.push(`/login sw=${r.sw}/${r.vw} out=${r.out.join(" | ")} clipped=${r.clipped.join(" | ")}`);
      for (const f of ["input", "button[type=submit]"]) await expect(page.locator(f).first()).toBeVisible();
      await ctx.close();
    }

    const ctx = await browser.newContext({ storageState: path.join(AUTH_DIR, "admin.json"), viewport: { width: w, height: 800 } });
    const page = await ctx.newPage();
    const urls = [...STATIC_PAGES];
    const list = await page.request.get("/api/requests").then((r) => r.json()).catch(() => []);
    if (Array.isArray(list) && list[0]?.id) urls.push(`/requests/${list[0].id}`);
    await page.goto("/warehouses", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    for (let depth = 0; depth < 4; depth++) {
      const href = await page.locator('a[href^="/warehouses/"]').first().getAttribute("href", { timeout: 1500 }).catch(() => null);
      if (!href) break;
      urls.push(href);
      await page.goto(href, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(900);
    }

    for (const url of [...new Set(urls)]) {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
      await page.waitForTimeout(900);
      const r = await scan(page);
      if (r.sw > r.vw || r.out.length || r.clipped.length) failures.push(`${url} sw=${r.sw}/${r.vw} out=[${r.out.join(" | ")}] clipped=[${r.clipped.join(" | ")}]`);
      const small = await smallTargets(page, "main");
      if (r.ellipsized.length) notes.push(`${url}: ELLIPSIS cuts text: ${r.ellipsized.join(" | ")}`);
      if (small.length) notes.push(`${url}: ${small.length} targets <44px e.g. ${small.slice(0, 3).join("; ")}`);
    }
    fs.writeFileSync(path.join(OUT, `sweep-${w}.txt`), [`failures:`, ...failures, `notes:`, ...notes].join("\n"));
    await ctx.close();
    expect(failures, failures.join("\n")).toEqual([]);
  });
}
