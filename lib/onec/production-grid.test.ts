import { describe, expect, it } from "vitest";
import { buildProductionView, dayDetail, type ProductionLineRow } from "./production-view";

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

const view = (lines: ProductionLineRow[], over: { month?: string; scope?: { departments: string[] | null }; lastReports?: { department: string; lastDay: string; recent: number }[] } = {}) =>
  buildProductionView({ month: over.month ?? MONTH, current: MONTH, today: TODAY, lines, ledger: [], scope: over.scope, lastReports: over.lastReports });
const row = (v: ReturnType<typeof view>, name: string) => v.grid.rows.find((r) => r.name === name)!;
const at = (v: ReturnType<typeof view>, date: string) => v.grid.days.indexOf(date);

describe("«Цех × Өдөр» хүснэгт: бүтэц", () => {
  const lines = () => [
    line({ product: "Шон", quantity: 700, day: "2098-04-09" }),
    line({ product: "Дэр", quantity: 1000, department: RAIL, day: "2098-04-09" }),
    line({ product: "Дэр", quantity: 900, department: "төмөр замын төмөр бетон дэрний хэсэг ", day: "2098-04-09" }), // давхардсан бичлэг: нэг мөр
  ];

  it("багана = сарын бүх өдөр (30), мөр = тохиргооны цехүүд (давхардсан хэлтэс нэг мөр)", () => {
    const v = view(lines());
    expect(v.grid.days).toHaveLength(30);
    expect(v.grid.days[0]).toBe("2098-04-01");
    expect(v.grid.rows.map((r) => r.name)).toEqual(["Бетон дэрний хэсэг", TEN]);
    expect(row(v, "Бетон дэрний хэсэг").cells).toHaveLength(30);
    expect(row(v, "Бетон дэрний хэсэг").cells[at(v, "2098-04-09")]).toEqual({ qty: [{ unit: "ширхэг", qty: 1900 }], unconfirmed: false });
  });

  it("нүд = тухайн өдрийн бэлэн гарц; гарцгүй өдөр null; «Сарын нийт» = нүднүүдийн нийлбэр", () => {
    const v = view([...lines(), line({ product: "Шон", quantity: 5, day: "2098-04-02" })]);
    const ten = row(v, TEN);
    expect(ten.cells[at(v, "2098-04-02")]!.qty).toEqual([{ unit: "ширхэг", qty: 5 }]);
    expect(ten.cells[at(v, "2098-04-03")]).toBeNull();
    expect(ten.total).toEqual([{ unit: "ширхэг", qty: 705 }]);
  });

  it("«Зас» нийлнэ, «Брак» нүдэнд орохгүй (бэлэн гарц)", () => {
    const v = view([line({ product: "Шон", quantity: 100 }), line({ product: "Шон Зас", quantity: 4 }), line({ product: "Шон Брак", quantity: 9 })]);
    expect(row(v, TEN).cells[at(v, TODAY)]!.qty).toEqual([{ unit: "ширхэг", qty: 104 }]);
  });

  it("зөвхөн сонгосон сарын өдрүүд: өмнөх сарын мөр орохгүй; өөр сарыг сонговол тэр сарын 31 өдөр", () => {
    const v = view([line({ product: "Шон", quantity: 7, day: "2098-03-31" }), line({ product: "Шон", quantity: 3, day: "2098-04-01" })]);
    expect(row(v, TEN).total).toEqual([{ unit: "ширхэг", qty: 3 }]);
    const mar = view([line({ product: "Шон", quantity: 7, day: "2098-03-31" })], { month: "2098-03" });
    expect(mar.grid.days).toHaveLength(31);
    expect(row(mar, TEN).cells[30]!.qty).toEqual([{ unit: "ширхэг", qty: 7 }]);
  });
});

describe("«Цех × Өдөр»: батлаагүй, гарцгүй цех, хагас боловсруулсан", () => {
  it("нягтлан батлаагүй баримт орсон өдрийн нүд unconfirmed (улбар шар цэг), тоо нийтэд орно", () => {
    const v = view([line({ product: "Шон", quantity: 10, posted: false }), line({ product: "Шон", quantity: 5, day: "2098-04-09" })]);
    expect(row(v, TEN).cells[at(v, TODAY)]).toEqual({ qty: [{ unit: "ширхэг", qty: 10 }], unconfirmed: true });
    expect(row(v, TEN).cells[at(v, "2098-04-09")]!.unconfirmed).toBe(false);
    expect(v.grid.totals.days[at(v, TODAY)]!.unconfirmed).toBe(true);
  });

  it("сард гарцгүй цех (өмнөх сард тайлантай): idle, мөр доор; идэвхтэй цехүүд тохиргооны дарааллаар", () => {
    const v = view([line({ product: "Шон", quantity: 4 })], { lastReports: [{ department: RAIL, lastDay: "2098-03-20", recent: 9 }, { department: "Металл хийц үйлдвэрлэлийн цех", lastDay: "2098-02-10", recent: 0 }] });
    expect(v.grid.rows.map((r) => [r.name, r.idle])).toEqual([[TEN, false], ["Бетон дэрний хэсэг", true], ["Металл хийц", true]]);
    const rail = row(v, "Бетон дэрний хэсэг");
    expect(rail.cells.every((c) => c === null)).toBe(true);
    expect(rail.total).toEqual([]);
    expect(rail.lastReport).toEqual({ day: "2098-03-20", daysAgo: 21 });
    expect(rail.lagging).toBe(true); // 9 тайлан, 21 хоног тайлангүй
    expect(row(v, "Металл хийц").lagging).toBe(false);
  });

  it("хагас боловсруулсан цех (БАЗ-3 + БАЗ-4 нэг мөр, м3) мөрөнд харагдана, «semi» тэмдэгтэй", () => {
    const v = view([line({ product: "Зуурмаг", quantity: 30, unit: "м3", stage: "semi", department: "БАЗ-3" }), line({ product: "Зуурмаг", quantity: 20, unit: "м3", stage: "semi", department: "БАЗ-4" })]);
    const baz = row(v, "Бетон зуурмаг (БАЗ-3, БАЗ-4)");
    expect(baz.semi).toBe(true);
    expect(baz.cells[at(v, TODAY)]!.qty).toEqual([{ unit: "шоо метр", qty: 50 }]);
    expect(baz.total).toEqual([{ unit: "шоо метр", qty: 50 }]);
  });
});

describe("«Өдрийн нийт»: нэгж тусдаа", () => {
  const lines = () => [
    line({ product: "Шон", quantity: 700 }),
    line({ product: "Элс", quantity: 80, unit: "м3", stage: "crusher", department: "Бутлан ангилах үйлдвэр" }),
    line({ product: "Хайрга", quantity: 20, unit: "м3", stage: "crusher", department: "Бутлан ангилах үйлдвэр" }),
    line({ product: "Зуурмаг", quantity: 50, unit: "м3", stage: "semi", department: "БАЗ-4" }),
    line({ product: "Каркас", quantity: 3, stage: "semi", department: "Арматурын хэсэг" }),
    line({ product: "Шон", quantity: 1, day: "2098-04-02" }),
  ];

  it("м3-ийг ширхэгтэй нэмэхгүй: нэгж бүр тусдаа; хагас боловсруулсан цех (БАЗ, Арматур) орохгүй", () => {
    const v = view(lines());
    expect(v.grid.totals.days[at(v, TODAY)]!.qty.map((q) => [q.unit, q.qty]).sort()).toEqual([["ширхэг", 700], ["шоо метр", 100]]);
    expect(v.grid.totals.month.map((q) => [q.unit, q.qty]).sort()).toEqual([["ширхэг", 701], ["шоо метр", 100]]);
    expect(v.grid.totals.days[at(v, "2098-04-02")]!.qty).toEqual([{ unit: "ширхэг", qty: 1 }]);
    expect(v.grid.totals.days[at(v, "2098-04-03")]).toBeNull();
  });
});

describe("«Цех × Өдөр»: хасагдсан хэлтэс, эрхийн хүрээ", () => {
  it("«Цайны газар» мөр, нийтэд орохгүй", () => {
    const v = view([line({ product: "Шон", quantity: 4 }), line({ product: "Хоол", quantity: 976, department: "Цайны газар" })]);
    expect(v.grid.rows.map((r) => r.name)).toEqual([TEN]);
    expect(v.grid.totals.month).toEqual([{ unit: "ширхэг", qty: 4 }]);
  });

  it("BOSS зөвхөн өөрийн цех: бусад цехийн мөр, нийт орохгүй; тохирохгүй бол хоосон", () => {
    const lines = [line({ product: "Шон", quantity: 4 }), line({ product: "Дэр", quantity: 900, department: RAIL })];
    const own = view(lines, { scope: { departments: ["тенсиланд хэсэг"] } });
    expect(own.grid.rows.map((r) => r.name)).toEqual([TEN]);
    expect(own.grid.totals.month).toEqual([{ unit: "ширхэг", qty: 4 }]);
    const none = view(lines, { scope: { departments: [] } });
    expect(none.grid.rows).toEqual([]);
    expect(none.grid.totals.days.every((d) => d === null)).toBe(true);
  });
});

describe("dayDetail: нүд / өдрийн толгойн задаргаа", () => {
  const lines = () => [
    line({ product: "Шон", quantity: 700, day: "2098-04-09", docNumber: "ТЕН 0409", docTime: "22:00" }),
    line({ product: "Шон Зас", quantity: 3, day: "2098-04-09", docNumber: "ТЕН 0409", docTime: "22:00" }),
    line({ product: "Шон Брак", quantity: 9, day: "2098-04-09", docNumber: "ТЕН 0409", docTime: "22:00", posted: false }),
    line({ product: "Дэр", quantity: 1200, department: RAIL, day: "2098-04-09", docNumber: "ТБДЦ 0409", docTime: "23:23" }),
    line({ product: "Зуурмаг", quantity: 40, unit: "м3", stage: "semi", department: "БАЗ-4", day: "2098-04-09" }),
    line({ product: "Шон", quantity: 5, day: "2098-04-08" }),
    line({ product: "Хоол", quantity: 976, department: "Цайны газар", day: "2098-04-09" }),
  ];

  it("өдрийн толгой (card-гүй): өдрийн бүх цех, тохиргооны дарааллаар; зөвхөн тэр өдөр; хасагдсан хэлтэс орохгүй", () => {
    const sections = dayDetail(lines(), { departments: null }, { day: "2098-04-09" });
    expect(sections.map((s) => s.card)).toEqual(["Бетон дэрний хэсэг", TEN, "Бетон зуурмаг (БАЗ-3, БАЗ-4)"]);
    expect(sections.find((s) => s.card === "Бетон зуурмаг (БАЗ-3, БАЗ-4)")!.semi).toBe(true);
  });

  it("нүд (card-тай): зөвхөн тэр цех; бүтээгдэхүүн, тоо, засвар, брак (тусдаа), 1С-ийн баримтын дугаар, цаг", () => {
    const [sec] = dayDetail(lines(), { departments: null }, { day: "2098-04-09", group: TEN });
    expect(sec.card).toBe(TEN);
    expect(sec.products.map((p) => [p.row.name, p.row.qty, p.row.defect, p.row.repairQty])).toEqual([["Шон", 703, false, 3], ["Шон · Брак", 9, true, 0]]);
    const main = sec.products[0].docs;
    expect(main.map((d) => [d.docNumber, d.time, d.quantity, d.repair])).toEqual([["ТЕН 0409", "22:00", 700, false], ["ТЕН 0409", "22:00", 3, true]].sort((a, b) => Number(a[3]) - Number(b[3])));
    expect(sec.products[1].docs[0]).toMatchObject({ docNumber: "ТЕН 0409", posted: false });
    expect(sec.unconfirmedDocs).toBe(1);
  });

  it("тэр өдөр тайлангүй, эсвэл эрхийн хүрээнээс гадуур: хоосон", () => {
    expect(dayDetail(lines(), { departments: null }, { day: "2098-04-03" })).toEqual([]);
    expect(dayDetail(lines(), { departments: [] }, { day: "2098-04-09" })).toEqual([]);
    const own = dayDetail(lines(), { departments: ["тенсиланд хэсэг"] }, { day: "2098-04-09" });
    expect(own.map((s) => s.card)).toEqual([TEN]);
  });

  it("харагдац (view) дотор баримтын дугаар байхгүй: зөвхөн dayDetail-д", () => {
    expect(JSON.stringify(view(lines()))).not.toContain("ТЕН 0409");
    expect(JSON.stringify(dayDetail(lines(), { departments: null }, { day: "2098-04-09" }))).toContain("ТЕН 0409");
  });
});
