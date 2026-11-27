import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { AUTH_DIR } from "./global-setup";

// Санхүүгийн бүх таб утсан дээр (360, 390px): хуудас хэвтээ гүйдэггүй, тоо агуулсан элемент (дүн, хувь, хэмжээ) баруун ирмэгээс тасрахгүй
// (scrollWidth ≤ clientWidth, эцэг элементийн overflow:hidden-ээр бүрхэгдэхгүй). Зөвхөн унших; ажиллаж буй апп + бодит өгөгдөл шаардана.
test.use({ storageState: path.join(AUTH_DIR, "admin.json"), isMobile: true, hasTouch: true });

const TABS: [string, string][] = [
  ["Мөнгөн хөрөнгө", "/finance/cash"],
  ["Бүтээгдэхүүн", "/finance/products"],
  ["Агуулах", "/finance/stock"],
  ["Борлуулалт", "/finance/sales"],
  ["Зарцуулалт", "/finance/usage"],
  ["Авлага", "/finance/receivables"],
  ["Зардал", "/finance/expenses"],
  ["Үйлдвэрлэл", "/finance/production"],
  ["Цалин", "/finance/payroll"],
  ["Хөтөч", "/onec"],
];

/** Дүн, хувь, хэмжээ шиг «тоо»-той богино бичвэр (урт бичвэрийн ellipsis зориудын). */
const AMOUNT_LIKE = /^[+\-−≈]?\s?\d[\d.,\s]*(%|\s?[^\s\d]{0,12})?$/;

export async function probe(page: Page) {
  return page.evaluate((src) => {
    const re = new RegExp(src);
    const vw = document.documentElement.clientWidth;
    const clipped: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent ?? "")
        .join("")
        .trim();
      if (!own || own.length > 28 || !re.test(own)) continue;
      const selfClip = el.scrollWidth > el.clientWidth + 1 && (cs.overflow !== "visible" || cs.textOverflow === "ellipsis");
      let hiddenByAncestor = false;
      for (let a: HTMLElement | null = el; a && a !== document.body; a = a.parentElement) {
        const acs = getComputedStyle(a);
        const ar = a.getBoundingClientRect();
        if ((acs.overflowX === "hidden" || acs.overflowX === "clip") && (r.right > ar.right + 1 || r.left < ar.left - 1)) {
          hiddenByAncestor = true;
          break;
        }
      }
      const scroller = el.closest("[class*='overflow-x-auto'],[class*='overflow-auto']");
      const offscreen = r.right > vw + 1 && !scroller;
      if (selfClip || hiddenByAncestor || offscreen) clipped.push(`«${own}» ${el.tagName.toLowerCase()} right=${Math.round(r.right)} vw=${vw}`);
    }
    return { overflow: document.documentElement.scrollWidth - vw, clipped };
  }, AMOUNT_LIKE.source);
}

for (const width of [360, 390]) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 844 } });
    for (const [label, url] of TABS) {
      test(`${label}: хэвтээ overflow 0, тоо тасрахгүй`, async ({ page }) => {
        await page.goto(url, { waitUntil: "networkidle" }).catch(() => undefined);
        await page.waitForTimeout(url.endsWith("/cash") ? 9000 : 3500);
        const r = await probe(page);
        expect(r.overflow, `хуудас ${r.overflow}px хэвтээ гүйж байна`).toBeLessThanOrEqual(0);
        expect(r.clipped, `тасарсан тоо: ${r.clipped.slice(0, 5).join("; ")}`).toEqual([]);
      });
    }
  });
}
