import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AccountCard, AccountCards, AccountPeriod } from "@/lib/onec/cash-accounts";
import { AccountCardView, AccountsSection, accountHref, fxText, idleLine, PeriodNumbers, signedMoney, todayLine } from "./AccountParts";
import { showSearchEmpty } from "./CashEntries";

const card = (over: Partial<AccountCard> = {}): AccountCard => ({
  id: "abc123def456",
  title: "ХААН банк ··6128 · MNT",
  subtitle: null,
  kind: "bank",
  bank: "ХААН банк",
  last4: "6128",
  currency: "MNT",
  closing: 896_967_410.48,
  closingFx: null,
  today: { inflow: 12_400_000, outflow: 361_100_000 },
  active: true,
  hidden: false,
  ...over,
});
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("fxText, todayLine", () => {
  it("валютын дүн: $ тэмдэгтэй, тэмдэггүй валют код дагуулна", () => {
    expect(fxText(266_090.05, "USD")).toBe("$266,090.05");
    expect(fxText(73.74, "USD")).toBe("$73.74");
    expect(fxText(5988.75, "CNY")).toBe("5,988.75 CNY");
    expect(fxText(1200, "EUR")).toBe("€1,200");
    expect(fxText(-10, "USD")).toBe("−$10");
    expect(fxText(113.74, "AUD")).toBe("113.74 AUD");
  });
  it("«Өнөөдөр: орсон +12.4 сая₮ · гарсан −361.1 сая₮»", () => {
    expect(todayLine({ inflow: 12_400_000, outflow: 361_100_000 })).toBe("Өнөөдөр: орсон +12.4 сая₮ · гарсан −361.1 сая₮");
    expect(todayLine({ inflow: 0, outflow: 0 })).toBe("Өнөөдөр: орсон 0₮ · гарсан 0₮");
  });
});

describe("AccountCardView", () => {
  it("гарчиг «ХААН банк ··6128 · MNT», том үлдэгдэл, өнөөдрийн орсон/гарсан; бүхэлдээ линк, доторх товч байхгүй", () => {
    const o = html(createElement(AccountCardView, { card: card() }));
    expect(o).toContain("ХААН банк ··6128 · MNT");
    expect(o).toContain("897.0 сая₮");
    expect(o).toContain("Өнөөдөр: орсон +12.4 сая₮ · гарсан −361.1 сая₮");
    expect(o).toContain(`href="${accountHref("abc123def456")}"`);
    expect(o).not.toContain("<button");
  });
  it("админы нэртэй: нэр том, банк + сүүлийн 4 орон + валют доор жижгээр", () => {
    const o = html(createElement(AccountCardView, { card: card({ title: "Үндсэн данс", subtitle: "ХААН банк ··6128 · MNT" }) }));
    expect(o).toContain("Үндсэн данс");
    expect(o).toContain("ХААН банк ··6128 · MNT");
    expect(o).toMatch(/text-base font-semibold[^>]*>Үндсэн данс/);
  });
  it("валютын данс: валютаар том, ₮ доор; ₮ данс: ₮ л", () => {
    const o = html(createElement(AccountCardView, { card: card({ title: "ХААН банк ··6139 · USD", currency: "USD", closing: 266_090.05, closingFx: 73.74 }) }));
    expect(o).toContain("$73.74");
    expect(o).toContain("266.1 мянга₮");
    expect(html(createElement(AccountCardView, { card: card() }))).not.toContain("$");
  });
  it("бүтэн дугаар (ADMIN) байвал харагдана, үгүй бол сүүлийн 4 орон л", () => {
    expect(html(createElement(AccountCardView, { card: card({ number: "5003636128" }) }))).toContain("5003636128");
    expect(html(createElement(AccountCardView, { card: card() }))).not.toContain("5003636128");
  });
  it("кассын карт", () => {
    const o = html(createElement(AccountCardView, { card: card({ title: "Касс · MNT", kind: "cash", bank: "", last4: "", closing: 5_869_887.95 }) }));
    expect(o).toContain("Касс · MNT");
    expect(o).toContain("5.9 сая₮");
  });
});

describe("AccountsSection", () => {
  const data: AccountCards = { asOf: "2026-11-25", accounts: [card(), card({ id: "second", title: "Касс · MNT", closing: 100 })], total: 9_131_568_057.59, hiddenCount: 1 };
  it("дээд талд бүх дансны нийт үлдэгдэл (₮), данс бүр нэг карт (нэг багана: grid-cols-1)", () => {
    const o = html(createElement(AccountsSection, { data, loading: false, error: null }));
    expect(o).toContain("9.13 тэрбум₮");
    expect(o).toContain("нуусан 1 данс орсон");
    expect((o.match(/<li>/g) ?? []).length).toBe(2);
    expect(o).toContain("grid-cols-1");
    expect(o).toContain("Данснууд");
  });
  it("ачаалж байхад Skeleton, алдаатай үед (өгөгдөлгүй) алдааны мөр, админд тохиргооны холбоос", () => {
    expect(html(createElement(AccountsSection, { data: null, loading: true, error: null }))).toContain("skeleton");
    expect(html(createElement(AccountsSection, { data: null, loading: false, error: "Алдаа 500" }))).toContain("Алдаа 500");
    expect(html(createElement(AccountsSection, { data, loading: false, error: null, manageHref: "/admin/cash-accounts" }))).toContain('href="/admin/cash-accounts"');
    expect(html(createElement(AccountsSection, { data, loading: false, error: null }))).not.toContain("/admin/cash-accounts");
  });
});

describe("PeriodNumbers: эхний | орсон | гарсан | эцсийн", () => {
  const period: AccountPeriod = { from: "2026-11-25", to: "2026-11-25", opening: 885_000_000, inflow: 12_400_000, outflow: 361_100_000, transfersIn: 1_000_000, transfersOut: 0, closing: 536_300_000, fx: null };
  it("дөрвөн тоо, шилжүүлгийн тайлбар", () => {
    const o = html(createElement(PeriodNumbers, { period, currency: "MNT" }));
    for (const t of ["Эхний үлдэгдэл", "Орсон", "Гарсан", "Эцсийн үлдэгдэл", "885.0 сая₮", "+12.4 сая₮", "−361.1 сая₮", "536.3 сая₮"]) expect(o, t).toContain(t);
    expect(o).toContain("шилжүүлсэн");
    expect(o).toContain("grid-cols-2");
  });
  it("валютын данс: валютаар ч харагдана", () => {
    const o = html(createElement(PeriodNumbers, { period: { ...period, fx: { opening: 100, inflow: 50, outflow: 20, transfersIn: 0, transfersOut: 0, closing: 130 } }, currency: "USD" }));
    for (const t of ["$100", "$50", "$20", "$130"]) expect(o, t).toContain(t);
  });
  it("0 дүн «0₮»; шилжүүлэггүй бол тайлбар байхгүй", () => {
    const o = html(createElement(PeriodNumbers, { period: { ...period, inflow: 0, outflow: 0, transfersIn: 0, transfersOut: 0 }, currency: "MNT" }));
    expect(o).toContain("0₮");
    expect(o).not.toContain("шилжүүлсэн");
  });
});

describe("захирлын харагдацад хориотой үгс (UI-ийн эх)", () => {
  const root = path.resolve(__dirname, "../../..");
  it.each(["components/finance/cash/AccountParts.tsx", "app/(app)/finance/cash/account/page.tsx", "app/api/dashboard/cash/accounts/route.ts", "app/api/dashboard/cash/account/route.ts"])("%s: «1С», Комментарий, дансны код хэрэглэгчид харагдах текстэд байхгүй", (f) => {
    const src = readFileSync(path.join(root, f), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");
    for (const w of ["1С", "Комментарий", "1201", "1101"]) expect(code, `${f}: ${w}`).not.toContain(w);
  });
  it("Мөнгөн хөрөнгө таб дээд хэсэгтээ «Данснууд» ба «Бүх гүйлгээ» жагсаалтыг (CashEntries) ӨӨРЧЛӨХГҮЙ дахин ашигладаг", () => {
    const page = readFileSync(path.join(root, "app/(app)/finance/cash/page.tsx"), "utf8");
    expect(page).toContain("<AccountsSection");
    expect(page.indexOf("<AccountsSection")).toBeLessThan(page.indexOf("<CashEntries"));
    const acct = readFileSync(path.join(root, "app/(app)/finance/cash/account/page.tsx"), "utf8");
    expect(acct).toContain("<CashEntries");
    expect(acct).toContain("accountId={data.account.id}");
    expect(acct).toContain("<DayBar");
    expect(acct).toContain("Энэ сар");
  });
});

describe("хөдөлгөөнгүй данс", () => {
  const act = (id: string, title: string, closing: number) => card({ id, title, closing, active: true });
  const idle = (id: string, title: string, closing: number) => card({ id, title, closing, active: false, today: { inflow: 0, outflow: 0 } });
  const data: AccountCards = { asOf: "2026-11-27", accounts: [act("a1", "Үндсэн данс", 900), act("a2", "Капитрон ··2132", 800), idle("i1", "Хас банк ··6457", 36_661_810), idle("i2", "Голомт ··0314", 35_444_752), idle("i3", "ТХБ ··9099", 1_647_689)], total: 1000, hiddenCount: 0 };
  const lastMoves = { i1: { date: "2026-08-14", amount: 660_000 }, i2: { date: "2026-10-05", amount: -1_035.49 }, i3: null };

  it("идэвхтэй дансууд эхэнд; «Хөдөлгөөнгүй данс (3)» нугалагдах хэсэг анхдагч ХААЛТТАЙ (дотор нь карт гарахгүй)", () => {
    const o = html(createElement(AccountsSection, { data, loading: false, error: null, lastMoves }));
    expect(o).toContain("Хөдөлгөөнгүй данс (3)");
    expect(o).toContain('aria-expanded="false"');
    expect((o.match(/<li>/g) ?? []).length).toBe(2); // идэвхтэй 2 л карт
    expect(o).toContain("Үндсэн данс");
    expect(o).not.toContain("Хас банк");
    expect(o.indexOf("Үндсэн данс")).toBeLessThan(o.indexOf("Хөдөлгөөнгүй данс"));
  });
  it("нээгдэхэд үлдэгдэлтэй хөдөлгөөнгүй картууд: «Хөдөлгөөнгүй · сүүлд 08-14», «Өнөөдөр: …» мөргүй", () => {
    const o = html(createElement(AccountsSection, { data, loading: false, error: null, lastMoves, initiallyOpen: true }));
    expect(o).toContain('aria-expanded="true"');
    expect((o.match(/<li>/g) ?? []).length).toBe(5);
    expect(o).toContain("Хөдөлгөөнгүй · сүүлд 08-14");
    expect(o).toContain("Хөдөлгөөнгүй · сүүлд 10-05");
    expect(o).toContain("36.7 сая₮");
    // идэвхтэй 2 карт «Өнөөдөр:» мөртэй, хөдөлгөөнгүй 3 карт мөргүй
    expect((o.match(/Өнөөдөр: орсон/g) ?? []).length).toBe(2);
  });
  it("сүүлийн гүйлгээ олдоогүй/хараахан ачаалаагүй бол зөвхөн «Хөдөлгөөнгүй»", () => {
    const o = html(createElement(AccountsSection, { data, loading: false, error: null, initiallyOpen: true }));
    expect(o).not.toContain("сүүлд");
    expect(o).toContain("Хөдөлгөөнгүй<");
    expect(idleLine(null)).toBe("Хөдөлгөөнгүй");
    expect(idleLine(undefined)).toBe("Хөдөлгөөнгүй");
    expect(idleLine({ date: "2026-08-14", amount: 1 })).toBe("Хөдөлгөөнгүй · сүүлд 08-14");
  });
  it("карт: хөдөлгөөнгүй бол саарал мөр; идэвхтэй бол «Өнөөдөр»", () => {
    const o = html(createElement(AccountCardView, { card: idle("i1", "Хас", 5), idle: true, last: { date: "2026-08-14", amount: 1 } }));
    expect(o).toContain("Хөдөлгөөнгүй · сүүлд 08-14");
    expect(o).toContain("text-text-muted/70");
    expect(o).not.toContain("Өнөөдөр");
  });
  it("бүх данс идэвхтэй бол хөдөлгөөнгүй хэсэг гарахгүй; бүгд хөдөлгөөнгүй бол тайлбар", () => {
    expect(html(createElement(AccountsSection, { data: { ...data, accounts: data.accounts.filter((c) => c.active) }, loading: false, error: null }))).not.toContain("Хөдөлгөөнгүй данс");
    expect(html(createElement(AccountsSection, { data: { ...data, accounts: data.accounts.filter((c) => !c.active) }, loading: false, error: null }))).toContain("Энэ сард гүйлгээтэй данс алга");
  });
  it("нийт үлдэгдэлд бүгд орно (хөдөлгөөнгүй ч): data.total-ийг картуудын нийлбэрээр биш серверийн нийтээр харуулна", () => {
    expect(html(createElement(AccountsSection, { data: { ...data, total: 9_131_568_057.59 }, loading: false, error: null }))).toContain("9.13 тэрбум₮");
  });
  it("signedMoney", () => {
    expect(signedMoney(12_400_000)).toBe("+12.4 сая₮");
    expect(signedMoney(-361_100)).toBe("−361.1 мянга₮");
  });
});

describe("хоосон жагсаалтын мессеж: «Хайлтад тохирох…» зөвхөн хайлттай үед", () => {
  it("showSearchEmpty", () => {
    expect(showSearchEmpty("", 0, true)).toBe(false); // хайлтгүй, дансны хуудас: «гүйлгээ хийгдээгүй…»
    expect(showSearchEmpty("84 сая", 0, true)).toBe(true);
    expect(showSearchEmpty("   ", 0, true)).toBe(false);
    expect(showSearchEmpty("", 1, true)).toBe(true); // шүүлт сонгосон
    expect(showSearchEmpty("", 0, false)).toBe(true); // «Бүх гүйлгээ» (emptyState-гүй) хуучнаараа
  });
  it("дансны хуудас: «энэ данснаас гүйлгээ хийгдээгүй», «Сүүлийн гүйлгээ», товч, горимын үг; DayBar нь бусад табтай ижил (◀ Өдөр сонгох байхгүй)", () => {
    const src = readFileSync(path.resolve(__dirname, "../../..", "app/(app)/finance/cash/account/page.tsx"), "utf8");
    for (const t of ["энэ данснаас гүйлгээ хийгдээгүй", "Сүүлийн гүйлгээ:", "Сүүлийн гүйлгээ рүү очих", "Энэ сард", "Энэ өдөр", "Өмнөх гүйлгээ олдсонгүй"]) expect(src, t).toContain(t);
    expect(src).not.toContain("Өдөр сонгох\n"); // хуучин «◀ Өдөр сонгох» товч
    expect(src).not.toContain("◀ Өдөр сонгох");
    expect(src).toContain("<DayBar day={pseudoDay}");
    expect(src).toContain('muted={mode === "month"}');
    expect(src).toContain("emptyState={<IdleNote");
  });
});
