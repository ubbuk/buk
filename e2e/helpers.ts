import type { Page } from "@playwright/test";

export const VIEWPORTS = [320, 360, 375, 390, 430, 768, 1024, 1440] as const;
export const heightFor = (w: number) => (w >= 1024 ? 900 : w >= 768 ? 1024 : 800);

export interface Offender {
  selector: string;
  kind: string;
  left: number;
  right: number;
  width: number;
}

// Walks every rendered element (including position:fixed / portaled ones, whose
// rects are viewport-relative) and reports those that stick out of the viewport.
// Elements inside a deliberate horizontal scroller (overflow-x: auto|scroll) are
// allowed to be wider than the viewport -- their *container* is still checked.
export async function scanOverflow(page: Page): Promise<{ pageScrollWidth: number; viewport: number; offenders: Offender[] }> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out: Offender[] = [];
    const name = (el: Element) => {
      const id = el.id ? `#${el.id}` : "";
      const cls = typeof (el as HTMLElement).className === "string" ? (el as HTMLElement).className.trim().split(/\s+/).slice(0, 4).join(".") : "";
      return `${el.tagName.toLowerCase()}${id}${cls ? "." + cls : ""}`;
    };
    const insideScroller = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === "auto" || ox === "scroll") return true;
      }
      return false;
    };
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      if (el.closest("svg") && el.tagName.toLowerCase() !== "svg") continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "absolute" && cs.clip !== "auto") continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.right <= vw + 1 && r.left >= -1) continue;
      if (insideScroller(el)) continue;
      // Off-screen decoration that never paints (e.g. translated-out drawers).
      if (cs.opacity === "0" || r.left >= vw || r.right <= 0) continue;
      out.push({ selector: name(el), kind: cs.position, left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) });
    }
    return { pageScrollWidth: document.documentElement.scrollWidth, viewport: vw, offenders: out.slice(0, 15) };
  });
}

// Visible interactive elements smaller than 44x44 (reported, asserted only where noted).
export async function smallTargets(page: Page, scope = "body") {
  return page.evaluate((scopeSel) => {
    const root = document.querySelector(scopeSel);
    if (!root) return [];
    const res: string[] = [];
    for (const el of Array.from(root.querySelectorAll<HTMLElement>("a[href],button,input:not([type=hidden]),select,textarea,[role=button]"))) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === "hidden") continue;
      if (r.width < 44 - 0.5 || r.height < 44 - 0.5) {
        res.push(`${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
    return res;
  }, scope);
}

// Input font-size below 16px makes iOS Safari zoom the page on focus.
export async function smallFontInputs(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]),select,textarea"))
      .filter((el) => el.getBoundingClientRect().width > 0 && parseFloat(getComputedStyle(el).fontSize) < 16)
      .map((el) => `${el.tagName.toLowerCase()}[${el.getAttribute("aria-label") ?? el.getAttribute("placeholder") ?? el.id ?? ""}] ${getComputedStyle(el).fontSize}`)
  );
}

// Checks an open dialog: inside the viewport, every control reachable (not covered by
// the bottom nav or anything else), close button >= 44px, page not scrolling sideways.
export async function checkDialog(page: Page) {
  await page.waitForTimeout(400); // let the dialog's open animation (scale 0.96 -> 1) finish before measuring
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const dlg = document.querySelector<HTMLElement>('[role="dialog"]');
    if (!dlg) return { problems: ["no dialog"] };
    const problems: string[] = [];
    const label = (b: HTMLElement) => (b.getAttribute("aria-label") ?? b.textContent ?? b.tagName).trim().slice(0, 24);
    const r = dlg.getBoundingClientRect();
    if (r.left < -0.5 || r.right > vw + 0.5) problems.push(`dialog horizontally out: ${Math.round(r.left)}-${Math.round(r.right)} of ${vw}`);
    if (r.top < -0.5 || r.bottom > vh + 0.5) problems.push(`dialog vertically out: ${Math.round(r.top)}-${Math.round(r.bottom)} of ${vh}`);
    for (const b of Array.from(dlg.querySelectorAll<HTMLElement>("button,a[href],input,textarea,select"))) {
      const br = b.getBoundingClientRect();
      if (br.width === 0 || br.height === 0) continue;
      const scroller = b.closest<HTMLElement>(".overflow-y-auto");
      if (scroller) {
        const sr = scroller.getBoundingClientRect();
        if (br.bottom < sr.top || br.top > sr.bottom) continue; // scrolled out of view inside the dialog: fine
      }
      if (br.right > vw + 0.5 || br.left < -0.5) problems.push(`control out of viewport: ${label(b)}`);
      const top = document.elementFromPoint(Math.min(Math.max(br.left + br.width / 2, 0), vw - 1), Math.min(Math.max(br.top + br.height / 2, 0), vh - 1));
      if (top && !dlg.contains(top)) problems.push(`covered: ${label(b)} by ${top.tagName.toLowerCase()}`);
    }
    const close = dlg.querySelector<HTMLElement>('button[aria-label="Хаах"]');
    if (close) {
      const cr = close.getBoundingClientRect();
      if (cr.width < 43.5 || cr.height < 43.5) problems.push(`close button ${Math.round(cr.width)}x${Math.round(cr.height)}`);
    }
    if (document.documentElement.scrollWidth > vw) problems.push(`page scrollWidth ${document.documentElement.scrollWidth} > ${vw}`);
    return { problems };
  });
}

export function describe(o: Awaited<ReturnType<typeof scanOverflow>>) {
  return `scrollWidth=${o.pageScrollWidth} viewport=${o.viewport}\n` + o.offenders.map((x) => `  ${x.selector} [${x.kind}] ${x.left}→${x.right} (w${x.width})`).join("\n");
}
