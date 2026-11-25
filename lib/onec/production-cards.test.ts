import { describe, expect, it } from "vitest";
import { buildProductionView, latestOutputDay, monthlyOutput, productDocs, STALE_DAYS, visibleLines, type ProductionLineRow, type ReportInfo } from "./production-view";

const TODAY = "2098-04-10";
const MONTH = "2098-04";
const RAIL = "Төмөр замын төмөр бетон дэрний хэсэг";
const TEN = "Тенсиланд хэсэг";

let n = 0;
const line = (over: Partial<ProductionLineRow> & Pick<ProductionLineRow, "product" | "quantity">): ProductionLineRow => ({
  day: TODAY,
  docRef: `doc-${++n}`,
  docNumber: `ТЕН ${n}`,
  docTime: "11:33",
  posted: true,
  stage: "finished",
  department: TEN,
  unit: "ш",
  ...over,
});

const view = (lines: ProductionLineRow[], over: { from?: string; to?: string; group?: string | null; lastReports?: ReportInfo[]; scope?: { departments: string[] | null }; history?: ProductionLineRow[]; month?: string } = {}) =>
  buildProductionView({ month: over.month ?? (over.to ?? TODAY).slice(0, 7), current: MONTH, today: TODAY, lines, ledger: [], from: over.from, to: over.to, group: over.group, lastReports: over.lastReports, scope: over.scope, history: over.history });
const card = (v: ReturnType<typeof view>, name: string) => v.cards.find((c) => c.name === name)!;

describe("картууд: тохиргооны дагуу (1С-ийн Parent биш)", () => {
  const lines = () => [
    line({ product: "Төмөр замын бетон дэр", quantity: 1000, department: RAIL }),
    line({ product: "Төмөр замын бетон дэр", quantity: 900, department: "төмөр замын төмөр бетон дэрний хэсэг ", day: "2098-04-09" }), // давхардсан бичлэг (өөр бичлэг, ижил нэр)
    line({ product: "Шон", quantity: 700 }),
    line({ product: "Бетон зуурмаг", quantity: 30.5, unit: "м3", stage: "semi", department: "БАЗ-3" }),
    line({ product: "Бетон зуурмаг", quantity: 20, unit: "м3", stage: "semi", department: "БАЗ-4" }),
    line({ product: "Каркас", quantity: 4, stage: "semi", department: "Арматурын хэсэг" }),
    line({ product: "Элс", quantity: 80, unit: "м3", stage: "crusher", department: "Бутлан ангилах үйлдвэр" }),
    line({ product: "Хоол", quantity: 976, department: "Цайны газар" }),
  ];

  it("карт бүр = тохиргооны нэр; давхардсан хэлтэс нэг картанд; тохиргооны дарааллаар; хасагдсан хэлтэс карт болохгүй", () => {
    const v = view(lines());
    expect(v.cards.map((c) => c.name)).toEqual(["Бетон дэрний хэсэг", TEN, "Бетон зуурмаг (БАЗ-3, БАЗ-4)", "Арматурын хэсэг", "Бутлан ангилах үйлдвэр"]);
    expect(v.groups).toEqual(v.cards.map((c) => c.name));
    expect(card(v, "Бетон дэрний хэсэг").departments).toEqual([RAIL, "төмөр замын төмөр бетон дэрний хэсэг "].sort((a, b) => a.localeCompare(b, "mn")));
    expect(card(v, "Бетон дэрний хэсэг").products.map((p) => [p.name, p.qty])).toEqual([["Төмөр замын бетон дэр", 1900]]); // хоёр бичлэг нэг бүтээгдэхүүнд нэгдсэн
  });

  it("БАЗ-3 + БАЗ-4 нэг карт, хагас боловсруулсан тэмдэгтэй, м3-ээр; картын гарцад 1431 орно ч нийт (KPI) гарцад ордоггүй", () => {
    const v = view(lines());
    const baz = card(v, "Бетон зуурмаг (БАЗ-3, БАЗ-4)");
    expect(baz.semi).toBe(true);
    expect(baz.month).toEqual([{ unit: "шоо метр", qty: 50.5 }]);
    expect(baz.products[0]).toMatchObject({ name: "Бетон зуурмаг", qty: 50.5, unit: "м3", stage: "semi" });
    expect(card(v, TEN).semi).toBe(false);
    expect(v.kpi.month).toEqual([{ unit: "ширхэг", qty: 2600 }]); // 1000 + 900 + 700, хагас боловсруулсан, бутлуургүй
  });

  it("«Энэ сар» (сарын 1-ээс өнөөдөр), «Сүүлийн 7 хоног» (өнөөдрөөс 6 хоногийн өмнөөс): сонгосон хугацаанаас үл хамаарна", () => {
    const old = [
      line({ product: "Шон", quantity: 10, day: "2098-04-03" }), // 7 хоногоос өмнө, энэ сард
      line({ product: "Шон", quantity: 5, day: "2098-04-04" }), // яг 7 хоногийн эхний өдөр (10 - 6)
      line({ product: "Шон", quantity: 100, day: "2098-03-31" }), // өмнөх сар
      line({ product: "Шон", quantity: 1, day: TODAY }),
    ];
    const v = view(old, { from: TODAY, to: TODAY });
    const c = card(v, TEN);
    expect(c.month).toEqual([{ unit: "ширхэг", qty: 16 }]);
    expect(c.week).toEqual([{ unit: "ширхэг", qty: 6 }]);
    expect(c.period).toEqual([{ unit: "ширхэг", qty: 1 }]);
  });

  it("тохиргоонд байхгүй хэлтэс «Бусад» картанд, тохиргоогүй тэмдэгтэй; хэлтсийн нэрс харагдана", () => {
    const v = view([line({ product: "Шон", quantity: 1 }), line({ product: "Шинэ бүтээгдэхүүн", quantity: 7, department: "Шинэ хэлтэс" }), line({ product: "Өөр", quantity: 3, department: "Өөр нэгж" })]);
    const other = card(v, "Бусад");
    expect(other.unconfigured).toBe(true);
    expect(other.departments).toEqual(["Өөр нэгж", "Шинэ хэлтэс"]);
    expect(other.month).toEqual([{ unit: "ширхэг", qty: 10 }]);
    expect(v.cards.at(-1)!.name).toBe("Бусад"); // хамгийн сүүлд
    expect(card(v, TEN).unconfigured).toBe(false);
  });

  it("карт дотор бүтээгдэхүүн: «Зас» нийлнэ, «Брак» тусдаа мөр, батлаагүй тэмдэг", () => {
    const v = view([line({ product: "Шон", quantity: 90 }), line({ product: "Шон Зас", quantity: 4 }), line({ product: "Шон Брак", quantity: 2, posted: false })]);
    expect(card(v, TEN).products.map((p) => [p.name, p.qty, p.defect, p.repairQty, p.unconfirmedQty])).toEqual([["Шон", 94, false, 4, 0], ["Шон · Брак", 2, true, 0, 2]]);
    expect(card(v, TEN).unconfirmedDocs).toBe(1);
  });
});

describe("сүүлийн тайлан ба «1С-д тайлан ороогүй» анхааруулга", () => {
  const rep = (department: string, lastDay: string, prevMonth = false): ReportInfo => ({ department, lastDay, prevMonth });

  it("STALE_DAYS = 3", () => {
    expect(STALE_DAYS).toBe(3);
  });

  it("сүүлийн тайлан: өдөр, хэд хоногийн өмнө (картад)", () => {
    const v = view([line({ product: "Шон", quantity: 1, day: "2098-04-09" })]);
    expect(card(v, TEN).lastReport).toEqual({ day: "2098-04-09", daysAgo: 1 });
    expect(card(v, TEN).stale).toBeNull();
  });

  it("3-аас бага хоног: анхааруулга байхгүй; яг 3 хоног: шар", () => {
    const two = view([], { lastReports: [rep(TEN, "2098-04-08", true)] });
    expect(card(two, TEN)).toMatchObject({ lastReport: { day: "2098-04-08", daysAgo: 2 }, stale: null });
    const three = view([], { lastReports: [rep(TEN, "2098-04-07")] });
    expect(card(three, TEN).stale).toBe("warn");
  });

  it("3+ хоног тайлан ороогүй, өмнөх сард гарцтай байсан бол улаан (alert); үгүй бол шар (warn)", () => {
    const v = view([], { lastReports: [rep(RAIL, "2098-03-20", true), rep("Металл хийц үйлдвэрлэлийн цех", "2098-02-10", false)] });
    expect(card(v, "Бетон дэрний хэсэг")).toMatchObject({ stale: "alert", lastReport: { day: "2098-03-20", daysAgo: 21 } });
    expect(card(v, "Металл хийц")).toMatchObject({ stale: "warn", lastReport: { day: "2098-02-10", daysAgo: 59 } });
  });

  it("өмнөх сарын мөр (энэ сард ачаалагдсан) байвал ч «өмнөх сард гарцтай»", () => {
    const v = view([line({ product: "Дэр", quantity: 5, department: RAIL, day: "2098-03-20" })], { lastReports: [] });
    expect(card(v, "Бетон дэрний хэсэг").stale).toBe("alert");
  });

  it("цехийн хэлтсүүдийн хамгийн сүүлийн тайлан (олон хэлтэстэй карт): аль нэг нь саяхан бол хоцролтгүй", () => {
    const v = view([], { lastReports: [rep("БАЗ-3", "2098-03-01", true), rep("БАЗ-4", "2098-04-09")] });
    expect(card(v, "Бетон зуурмаг (БАЗ-3, БАЗ-4)")).toMatchObject({ lastReport: { day: "2098-04-09", daysAgo: 1 }, stale: null });
  });

  it("тайлан огт байхгүй цех карт болохгүй; өнөөдрийн тайлан «0 хоног»", () => {
    const v = view([line({ product: "Шон", quantity: 1 })], { lastReports: [] });
    expect(v.cards.map((c) => c.name)).toEqual([TEN]);
    expect(card(v, TEN).lastReport!.daysAgo).toBe(0);
  });

  it("эрхийн хүрээнээс гадуурх, хасагдсан хэлтсийн тайлан орохгүй", () => {
    const v = view([], { lastReports: [rep(RAIL, "2098-03-20", true), rep("Цайны газар", "2098-04-09")], scope: { departments: ["тенсиланд хэсэг"] } });
    expect(v.cards).toEqual([]);
    const all = view([], { lastReports: [rep("Цайны газар", "2098-04-09")] });
    expect(all.cards).toEqual([]);
  });
});

describe("цех сонгох (group = картын нэр)", () => {
  const lines = () => [
    line({ product: "Шон", quantity: 100 }),
    line({ product: "Дэр", quantity: 30, department: RAIL }),
    line({ product: "Дэр Брак", quantity: 3, department: RAIL }),
  ];

  it("KPI, график, бүтээгдэхүүн сонгосон картаар шүүгдэнэ; бүх карт үлдэнэ (шүүлтүүрийн сонголт)", () => {
    const v = view(lines(), { group: "Бетон дэрний хэсэг" });
    expect(v.group).toBe("Бетон дэрний хэсэг");
    expect(v.cards.map((c) => c.name)).toEqual(["Бетон дэрний хэсэг", TEN]);
    expect(v.kpi.month).toEqual([{ unit: "ширхэг", qty: 30 }]);
    expect(v.kpi.defectPct).toBe(9.1);
    expect(v.products.map((p) => p.name)).toEqual(["Дэр", "Дэр · Брак"]);
    expect(v.chart!.days.find((d) => d.date === TODAY)!.confirmed).toBe(30);
  });

  it("байхгүй карт сонговол бүх цех", () => {
    expect(view(lines(), { group: "Байхгүй" }).group).toBeNull();
  });
});

describe("сүүлийн 12 сарын гарц", () => {
  const rail = (day: string, quantity: number, over: Partial<ProductionLineRow> = {}) => line({ product: "Төмөр замын бетон дэр", quantity, department: RAIL, day, ...over });
  const history = [rail("2098-01-05", 100), rail("2098-02-05", 200), rail("2098-02-06", 50, { posted: false }), rail("2098-04-02", 30), rail("2097-04-30", 999), rail("2097-05-02", 7)];

  it("12 сар (сонгосон сарын эцэс хүртэл), хоосон сар 0, батлаагүй тусдаа; 12 сараас өмнөх мөр орохгүй", () => {
    const m = monthlyOutput(history, { departments: null }, "Бетон дэрний хэсэг", "2098-04")!;
    expect(m.unit).toBe("ширхэг");
    expect(m.months).toHaveLength(12);
    expect(m.months[0].month).toBe("2097-05");
    expect(m.months.at(-1)!.month).toBe("2098-04");
    expect(Object.fromEntries(m.months.filter((x) => x.confirmed || x.unconfirmed).map((x) => [x.month, [x.confirmed, x.unconfirmed]]))).toEqual({ "2097-05": [7, 0], "2098-01": [100, 0], "2098-02": [200, 50], "2098-04": [30, 0] });
  });

  it("хагас боловсруулсан карт (БАЗ) нь 1431-ийг тоолно; цех сонгоогүй бол зөвхөн бэлэн бүтээгдэхүүн", () => {
    const h = [line({ product: "Зуурмаг", quantity: 12, unit: "м3", stage: "semi", department: "БАЗ-4", day: "2098-03-01" }), line({ product: "Шон", quantity: 5, day: "2098-03-02" })];
    expect(monthlyOutput(h, { departments: null }, "Бетон зуурмаг (БАЗ-3, БАЗ-4)", "2098-04")!.unit).toBe("шоо метр");
    expect(monthlyOutput(h, { departments: null }, "Бетон зуурмаг (БАЗ-3, БАЗ-4)", "2098-04")!.months.find((x) => x.month === "2098-03")!.confirmed).toBe(12);
    const all = monthlyOutput(h, { departments: null }, null, "2098-04")!;
    expect(all.unit).toBe("ширхэг");
    expect(all.months.find((x) => x.month === "2098-03")!.confirmed).toBe(5);
  });

  it("гарцгүй, эсвэл эрхийн хүрээнээс гадуур: null", () => {
    expect(monthlyOutput([], { departments: null }, "Бетон дэрний хэсэг", "2098-04")).toBeNull();
    expect(monthlyOutput(history, { departments: ["тенсиланд хэсэг"] }, "Бетон дэрний хэсэг", "2098-04")).toBeNull();
  });

  it("view-д history-оос ирнэ (сонгосон хугацаанд гарц байхгүй ч 12 сарын график гарна)", () => {
    const v = view([], { group: null, history, to: "2098-04-10", from: "2098-04-10", lastReports: [{ department: RAIL, lastDay: "2098-04-02", prevMonth: false }] });
    expect(v.monthly!.months.find((x) => x.month === "2098-02")!.confirmed).toBe(200); // цех сонгоогүй: бүх бэлэн бүтээгдэхүүн
    const sel = view([], { group: "Бетон дэрний хэсэг", history, lastReports: [{ department: RAIL, lastDay: "2098-04-02", prevMonth: false }] });
    expect(sel.group).toBe("Бетон дэрний хэсэг");
    expect(sel.monthly!.months.find((x) => x.month === "2098-02")!.confirmed).toBe(200);
  });
});

describe("latest өдөр, drill-down, харагдах мөр", () => {
  it("latestOutputDay: эрхийн хүрээн дэх бэлэн/бутлуурын гарцтай хамгийн сүүлийн өдөр, хагас боловсруулсан, хасагдсан хэлтэс тооцохгүй", () => {
    const lines = [
      line({ product: "Шон", quantity: 1, day: "2098-04-05" }),
      line({ product: "Каркас", quantity: 1, day: "2098-04-08", stage: "semi" }),
      line({ product: "Шон", quantity: 1, day: "2098-04-11" }),
      line({ product: "Элс", quantity: 1, day: "2098-04-07", stage: "crusher", department: "Бутлан ангилах үйлдвэр" }),
      line({ product: "Шон", quantity: 1, day: "2098-04-09", department: "Цайны газар" }),
    ];
    expect(latestOutputDay(lines, { departments: null }, TODAY)).toBe("2098-04-07");
    expect(latestOutputDay(lines, { departments: [] }, TODAY)).toBeNull();
  });

  it("баримтын жагсаалт: дугаар, өдөр, цаг; сонгосон карт, хугацаагаар шүүгдсэн мөрүүдээр", () => {
    const lines = [
      line({ product: "Шон", quantity: 1, day: "2098-04-09", docNumber: "A 1", docTime: "09:05" }),
      line({ product: "Шон", quantity: 2, day: "2098-04-09", docNumber: "A 2", department: "Төмөр бетон хийц эдлэлийн цех" }),
      line({ product: "Шон", quantity: 3, day: "2098-04-01", docNumber: "A 3" }),
    ];
    const seen = visibleLines(lines, { departments: null }, { group: TEN, from: "2098-04-09", to: "2098-04-09" });
    expect(seen.map((l) => l.docNumber)).toEqual(["A 1"]);
    const id = view(seen).products[0].id;
    expect(productDocs(seen, id)).toEqual([expect.objectContaining({ docNumber: "A 1", day: "2098-04-09", time: "09:05", quantity: 1 })]);
  });

  it("visibleLines: эрхийн хүрээнээс гадуурх болон хасагдсан хэлтэс орохгүй; картын нэрээр (давхардсан бичлэг нэгдэнэ)", () => {
    const lines = [line({ product: "Шон", quantity: 1 }), line({ product: "Хоол", quantity: 1, department: "Цайны газар" }), line({ product: "Дэр", quantity: 1, department: RAIL })];
    expect(visibleLines(lines, { departments: null }).map((l) => l.product)).toEqual(["Шон", "Дэр"]);
    expect(visibleLines(lines, { departments: ["тенсиланд хэсэг"] }).map((l) => l.product)).toEqual(["Шон"]);
    expect(visibleLines(lines, { departments: null }, { group: "Бетон дэрний хэсэг" }).map((l) => l.product)).toEqual(["Дэр"]);
  });

  it("клиентэд очих view дотор баримтын дугаар байхгүй", () => {
    const v = view([line({ product: "Шон", quantity: 1, docNumber: "СЭРГЭЭ-777" })]);
    expect(JSON.stringify(v)).not.toContain("СЭРГЭЭ-777");
  });
});
