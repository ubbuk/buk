import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { niceMax } from "./DailyBarChart";
import { kpiValueSize } from "./NgParts";
import { CategoryPanel } from "./cash/CategoryPanel";
import { formatAxisShort, formatAxisValue } from "@/lib/money-short";
import type { FlowReport } from "@/lib/onec/cash-report";

describe("сарын график: тэнхлэгийн дээд хязгаар", () => {
  it("хамгийн өндөр баганыг ЗАВАЛ багтаана (ямар ч утгад)", () => {
    for (const v of [1, 7, 999, 33_427_738_646, 29_734_140_045, 40_000_000_000, 40_000_000_001, 1.5e9, 2.5e10, 123_456_789_012]) {
      const m = niceMax(v);
      expect(m).toBeGreaterThanOrEqual(v);
      expect(m).toBeLessThan(v * 10);
    }
    expect(niceMax(33_427_738_646)).toBe(40_000_000_000);
    expect(niceMax(0)).toBe(1);
  });
  it("утасны шошго богино: 20 тэрбум → 20 т, 250 сая → 250 с, 12 мянга → 12 м", () => {
    expect(formatAxisShort(20e9)).toBe("20 т");
    expect(formatAxisShort(250e6)).toBe("250 с");
    expect(formatAxisShort(12_000)).toBe("12 м");
    expect(formatAxisShort(0)).toBe("0");
    expect(formatAxisValue(20e9)).toBe("20 тэрбум");
  });
});

describe("KPI картын тооны хэмжээ", () => {
  it("урт дүн утсан дээр жижиг, богино нь том; өргөн дэлгэц дээр хуучин хэмжээ", () => {
    expect(kpiValueSize("5.9 сая₮".length)).toContain("text-lg");
    expect(kpiValueSize("8.15 тэрбум₮".length)).toContain("text-[15px]");
    expect(kpiValueSize("123.45 тэрбум₮".length)).toContain("text-[13px]");
    expect(kpiValueSize(20)).toContain("sm:text-[19px]");
    expect(kpiValueSize(5)).toContain("sm:text-[25px]");
  });
});

describe("Ангиллын мөр: 2 давхар", () => {
  const flow: FlowReport = {
    total: 5_454_780_865,
    categories: [{ id: "sales", label: "Борлуулалтын орлого", total: 4_090_000_000, share: 0.75, count: 3, parties: [], moreParties: { count: 0, total: 0 } }],
  } as unknown as FlowReport;
  it("1-р мөр нэр + дүн (дүн shrink-0), 2-р мөр бар + хувь; гарчгийн «ангилал» тасрахгүй", () => {
    const html = renderToStaticMarkup(<CategoryPanel title="Хаанаас орж ирсэн" tone="in" flow={flow} onPickCategory={() => undefined} onPickParty={() => undefined} />);
    expect(html).toContain("whitespace-nowrap");
    expect(html).toContain("1 ангилал");
    expect(html).toContain("4.09 тэрбум");
    // хувь нь бар-тай ижил мөрөнд (pl-6), нэрний мөрөнд биш
    const nameRow = html.indexOf("Борлуулалтын орлого");
    const pct = html.indexOf("75%");
    expect(pct).toBeGreaterThan(nameRow);
    expect(html.slice(nameRow, pct)).toContain("pl-6");
    expect(html).toContain("min-w-0");
  });
});
