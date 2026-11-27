import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { formatMoneyShort } from "@/lib/money-short";
import { CashEntries, DIR_OPTIONS, NO_FILTER, dirSummary } from "./CashEntries";

describe("dirSummary: баруун дээд талын нийт", () => {
  it("Орсон: ногоон, «+» тэмдэгтэй, нийлбэр", () => {
    const s = dirSummary("inflow", 128, 4_090_000_000, 4_090_000_000);
    expect(s).toMatchObject({ label: "Орсон", count: "128 гүйлгээ", value: 4_090_000_000, signed: true, tone: "success" });
    expect(`+${formatMoneyShort(s.value)}`).toBe("+4.09 тэрбум₮");
  });
  it("Гарсан: улаан, «−» тэмдэгтэй (сөрөг утга)", () => {
    const s = dirSummary("outflow", 40, -1_500_000, 1_500_000);
    expect(s).toMatchObject({ label: "Гарсан", value: -1_500_000, tone: "danger", signed: true });
    expect(formatMoneyShort(s.value)).toMatch(/^[-−]1\.5 сая₮$/);
  });
  it("Шилжүүлэг: тэмдэггүй, саарал; Бүгд: цэвэр дүн", () => {
    expect(dirSummary("transfer", 3, 0, 900)).toMatchObject({ label: "Шилжүүлэг", value: 900, signed: false, tone: "neutral" });
    expect(dirSummary("", 9, 3000, 7000)).toMatchObject({ label: "", value: 3000, signed: true });
  });
});

describe("«Бүх гүйлгээ»: чиглэлийн товчнууд", () => {
  const render = (flow: "" | "inflow" | "outflow" | "transfer", dirChips = true) =>
    renderToStaticMarkup(<CashEntries month="2026-11" filter={{ ...NO_FILTER, flow }} onFilter={() => undefined} version="" dirChips={dirChips} />);

  it("дараалал Бүгд, Орсон, Гарсан, Шилжүүлэг", () => {
    expect(DIR_OPTIONS.map((o) => o.label)).toEqual(["Бүгд", "Орсон", "Гарсан", "Шилжүүлэг"]);
  });
  it("хайлтын хайрцгийн ДООР, нэг мөрөнд (flex, wrap-гүй), анхдагч Бүгд сонгогдсон", () => {
    const html = render("");
    expect(html.indexOf('aria-label="Гүйлгээ хайх"')).toBeLessThan(html.indexOf('data-testid="cash-dir-filter"'));
    const group = html.slice(html.indexOf('data-testid="cash-dir-filter"'));
    expect(group.slice(0, group.indexOf("</div>"))).not.toContain("flex-wrap");
    const pressed = [...group.matchAll(/aria-pressed="(true|false)"[^>]*>([^<]+)</g)].slice(0, 4).map((m) => `${m[2]}:${m[1]}`);
    expect(pressed).toEqual(["Бүгд:true", "Орсон:false", "Гарсан:false", "Шилжүүлэг:false"]);
  });
  it("сонгосон товч aria-pressed; Орсон ногоон, Гарсан улаан", () => {
    expect(render("inflow")).toMatch(/aria-pressed="true"[^>]*class="[^"]*text-success[^"]*"[^>]*>Орсон</);
    expect(render("outflow")).toMatch(/aria-pressed="true"[^>]*class="[^"]*text-danger[^"]*"[^>]*>Гарсан</);
    expect(render("transfer")).toMatch(/aria-pressed="true"[^>]*>Шилжүүлэг</);
  });
  it("товчнууд хэвийн жижиг дэлгэцэнд багтана: min-w-0 flex-auto, whitespace-nowrap", () => {
    const html = render("");
    expect(html.match(/min-w-0 flex-auto whitespace-nowrap/g)).toHaveLength(4);
  });
  it("дансны хуудас (dirChips үгүй) өөрчлөгдөхгүй: товч байхгүй", () => {
    expect(render("", false)).not.toContain("cash-dir-filter");
  });
});
