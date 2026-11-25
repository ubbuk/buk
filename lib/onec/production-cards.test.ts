import { describe, expect, it } from "vitest";
import { buildProductionView, latestOutputDay, productDocs, visibleLines, type ProductionLedgerRow, type ProductionLineRow } from "./production-view";

const TBHC = "Төмөр бетон хийц эдлэлийн цех";
const TODAY = "2098-04-10";
const MONTH = "2098-04";

let n = 0;
const line = (over: Partial<ProductionLineRow> & Pick<ProductionLineRow, "product" | "quantity">): ProductionLineRow => ({
  day: TODAY,
  docRef: `doc-${++n}`,
  docNumber: `ТЕН ${n}`,
  docTime: "11:33",
  posted: true,
  stage: "finished",
  department: "Тенсиланд хэсэг",
  group: TBHC,
  unit: "ш",
  ...over,
});

const view = (lines: ProductionLineRow[], over: { from?: string; to?: string; group?: string | null; ledger?: ProductionLedgerRow[]; scope?: { departments: string[] | null } } = {}) =>
  buildProductionView({ month: (over.to ?? TODAY).slice(0, 7), current: MONTH, today: TODAY, lines, ledger: over.ledger ?? [], from: over.from, to: over.to, group: over.group, scope: over.scope });

describe("цех (эх хэлтэс) бүрийн карт", () => {
  const lines = () => [
    line({ product: "Төмөр бетон цагираг", quantity: 12, day: "2098-04-09" }),
    line({ product: "Төмөр бетон цагираг Зас", quantity: 1, day: "2098-04-09", department: "БАЗ-3" }),
    line({ product: "Төмөр бетон цагираг Брак", quantity: 2, day: "2098-04-09", department: "БАЗ-3" }),
    line({ product: "Шон", quantity: 700, day: TODAY, posted: false, department: "Вольтамиксийн хэсэг" }),
    line({ product: "Дэр", quantity: 50, day: "2098-04-02", department: "Төмөр замын дэрний хэсэг", group: "Төмөр замын дэрний хэсэг" }),
    line({ product: "Элс", quantity: 80, unit: "м3", stage: "crusher", department: "Бутлан ангилах үйлдвэр", group: "Бутлан ангилах үйлдвэр", day: "2098-04-09" }),
  ];

  it("дэд хэлтсүүд (Тенсиланд, БАЗ-3, Вольтамикс) эх цехийнхээ ГАНЦ картанд; бутлуур тусдаа карт", () => {
    const v = view(lines(), { from: "2098-04-09", to: "2098-04-09" });
    expect(v.groups).toEqual(["Бутлан ангилах үйлдвэр", "Төмөр бетон хийц эдлэлийн цех", "Төмөр замын дэрний хэсэг"]);
    expect(v.cards.map((c) => c.name).sort()).toEqual([...v.groups].sort());
    const tbhc = v.cards.find((c) => c.name === TBHC)!;
    expect(tbhc.subDepartments).toEqual(["БАЗ-3", "Вольтамиксийн хэсэг", "Тенсиланд хэсэг"]);
  });

  it("карт дотор бүтээгдэхүүн бүр: «Зас» нийлнэ, «Брак» тусдаа мөр, нэгж, батлаагүй", () => {
    const v = view(lines(), { from: "2098-04-09", to: TODAY });
    const tbhc = v.cards.find((c) => c.name === TBHC)!;
    expect(tbhc.products.map((p) => [p.name, p.qty, p.unit, p.defect, p.repairQty, p.unconfirmedQty])).toEqual([
      ["Шон", 700, "ш", false, 0, 700],
      ["Төмөр бетон цагираг", 13, "ш", false, 1, 0],
      ["Төмөр бетон цагираг · Брак", 2, "ш", true, 0, 0],
    ]);
    expect(tbhc.unconfirmedDocs).toBe(1);
    const crusher = v.cards.find((c) => c.name === "Бутлан ангилах үйлдвэр")!;
    expect(crusher.products).toEqual([expect.objectContaining({ name: "Элс", qty: 80, unit: "м3", stage: "crusher" })]);
  });

  it("гарчигт «Өнөөдөр» ба «Сар»: сонгосон хугацаанаас үл хамаарна (өнөөдөр, сонгосон сар); брак орохгүй", () => {
    const v = view(lines(), { from: "2098-04-09", to: "2098-04-09" });
    const tbhc = v.cards.find((c) => c.name === TBHC)!;
    expect(tbhc.period).toEqual([{ unit: "ширхэг", qty: 13 }]); // сонгосон өдөр: 12 + 1 засвар, бракгүй
    expect(tbhc.today).toEqual([{ unit: "ширхэг", qty: 700 }]);
    expect(tbhc.month).toEqual([{ unit: "ширхэг", qty: 713 }]);
    const crusher = v.cards.find((c) => c.name === "Бутлан ангилах үйлдвэр")!;
    expect(crusher.period).toEqual([{ unit: "шоо метр", qty: 80 }]);
  });

  it("хугацаа картын тоог шинэчилнэ; үйлдвэрлэлгүй цех «empty», дараалалд хамгийн сүүлд", () => {
    const day = view(lines(), { from: "2098-04-02", to: "2098-04-02" });
    expect(day.cards.map((c) => [c.name, c.empty])).toEqual([["Төмөр замын дэрний хэсэг", false], ["Бутлан ангилах үйлдвэр", true], ["Төмөр бетон хийц эдлэлийн цех", true]].sort((a, b) => Number(a[1]) - Number(b[1])));
    expect(day.cards.at(-1)!.products).toEqual([]);
    expect(day.cards[0].name).toBe("Төмөр замын дэрний хэсэг");
    const week = view(lines(), { from: "2098-04-02", to: TODAY });
    expect(week.cards.every((c) => !c.empty)).toBe(true);
    expect(week.cards[0].name).toBe(TBHC); // хамгийн их гарцтай эхэнд
  });

  it("зөвхөн хагас боловсруулсан гарцтай хэлтэс карт, шүүлтүүрийн сонголтод орохгүй", () => {
    const v = view([...lines(), line({ product: "Каркас", quantity: 5, stage: "semi", department: "Арматурын хэсэг", group: "Арматурын хэсэг" })]);
    expect(v.groups).not.toContain("Арматурын хэсэг");
    expect(v.cards.some((c) => c.name === "Арматурын хэсэг")).toBe(false);
  });

  it("эх хэлтэс заагаагүй (хуучин мөр) бол хэлтэс өөрөө карт", () => {
    const v = view([line({ product: "Шон", quantity: 4, group: "" })]);
    expect(v.cards.map((c) => c.name)).toEqual(["Тенсиланд хэсэг"]);
    expect(v.cards[0].subDepartments).toEqual([]);
  });
});

describe("«Бүх цех ▾» шүүлтүүр (group)", () => {
  const lines = () => [
    line({ product: "Шон", quantity: 100 }),
    line({ product: "Дэр", quantity: 30, department: "Дэрний хэсэг", group: "Дэрний хэсэг", unit: "ш" }),
    line({ product: "Дэр Брак", quantity: 3, department: "Дэрний хэсэг", group: "Дэрний хэсэг" }),
  ];

  it("сонгосон цехээр KPI, график, бүтээгдэхүүний жагсаалт, карт бүгд шүүгдэнэ; сонголтууд бүх цехээр үлдэнэ", () => {
    const v = view(lines(), { group: "Дэрний хэсэг" });
    expect(v.group).toBe("Дэрний хэсэг");
    expect(v.groups).toEqual(["Дэрний хэсэг", TBHC]);
    expect(v.cards.map((c) => c.name)).toEqual(["Дэрний хэсэг"]);
    expect(v.products.map((p) => p.name)).toEqual(["Дэр", "Дэр · Брак"]);
    expect(v.kpi.month).toEqual([{ unit: "ширхэг", qty: 30 }]);
    expect(v.kpi.defectPct).toBe(9.1); // 3 / (30 + 3)
    expect(v.chart!.days.find((d) => d.date === TODAY)!.confirmed).toBe(30);
  });

  it("байхгүй цех сонговол бүх цех", () => {
    const v = view(lines(), { group: "Байхгүй" });
    expect(v.group).toBeNull();
    expect(v.cards).toHaveLength(2);
  });
});

describe("хугацаа (from..to) ба сар", () => {
  const lines = () => [line({ product: "Шон", quantity: 10, day: "2098-04-08" }), line({ product: "Шон", quantity: 20, day: "2098-04-09" }), line({ product: "Шон", quantity: 40, day: TODAY }), line({ product: "Шон", quantity: 5, day: "2098-03-30" })];

  it("KPI, бүтээгдэхүүний жагсаалт сонгосон хугацаагаар; график, «Сар» нь сарын бүтэн; хугацаа харагдацад буцна", () => {
    const v = view(lines(), { from: "2098-04-08", to: "2098-04-09" });
    expect(v.period).toEqual({ from: "2098-04-08", to: "2098-04-09" });
    expect(v.kpi.month).toEqual([{ unit: "ширхэг", qty: 30 }]);
    expect(v.products[0].qty).toBe(30);
    expect(v.kpi.today).toEqual([{ unit: "ширхэг", qty: 40 }]);
    expect(v.cards[0].month).toEqual([{ unit: "ширхэг", qty: 70 }]);
    expect(v.chart!.days.map((d) => d.confirmed).reduce((a, b) => a + b, 0)).toBe(70);
    expect(v.todayDate).toBe(TODAY);
  });

  it("сарын хилийг давсан хугацаа: өмнөх сарын мөр орно, график зөвхөн сарын (to) өдрүүд", () => {
    const v = view(lines(), { from: "2098-03-30", to: "2098-04-08" });
    expect(v.kpi.month).toEqual([{ unit: "ширхэг", qty: 15 }]); // 5 (3-р сар) + 10
    expect(v.chart!.days[0].date).toBe("2098-04-01");
  });

  it("from, to өгөөгүй бол сар бүтнээрээ (хуучин зан)", () => {
    const v = view(lines().filter((l) => l.day.startsWith("2098-04")));
    expect(v.kpi.month).toEqual([{ unit: "ширхэг", qty: 70 }]);
    expect(v.period).toEqual({ from: "2098-04-01", to: "2098-04-30" });
  });
});

describe("латест өдөр, drill-down, харагдах мөр", () => {
  it("latestOutputDay: эрхийн хүрээн дэх бэлэн/бутлуурын гарцтай хамгийн сүүлийн өдөр (өнөөдрөөс ихгүй), хагас боловсруулсан тооцохгүй", () => {
    const lines = [
      line({ product: "Шон", quantity: 1, day: "2098-04-05" }),
      line({ product: "Каркас", quantity: 1, day: "2098-04-08", stage: "semi" }),
      line({ product: "Шон", quantity: 1, day: "2098-04-11" }), // ирээдүй
      line({ product: "Элс", quantity: 1, day: "2098-04-07", stage: "crusher", department: "Бутлан", group: "Бутлан" }),
      line({ product: "Шон", quantity: 1, day: "2098-04-09", department: "Цайны газар", group: "Цайны газар" }), // хасагдсан
    ];
    expect(latestOutputDay(lines, { departments: null }, TODAY)).toBe("2098-04-07");
    expect(latestOutputDay(lines, { departments: ["бутлан"] }, TODAY)).toBe("2098-04-07");
    expect(latestOutputDay(lines, { departments: [] }, TODAY)).toBeNull();
    expect(latestOutputDay([], { departments: null }, TODAY)).toBeNull();
  });

  it("баримтын жагсаалт: дугаар, өдөр, цаг; цех, хугацаагаар шүүгдсэн мөрүүдээр", () => {
    const lines = [
      line({ product: "Шон", quantity: 1, day: "2098-04-09", docNumber: "A 1", docTime: "09:05" }),
      line({ product: "Шон", quantity: 2, day: "2098-04-09", docNumber: "A 2", docTime: "22:00", group: "Өөр цех", department: "Өөр цех" }),
      line({ product: "Шон", quantity: 3, day: "2098-04-01", docNumber: "A 3" }),
    ];
    const seen = visibleLines(lines, { departments: null }, { group: TBHC, from: "2098-04-09", to: "2098-04-09" });
    expect(seen.map((l) => l.docNumber)).toEqual(["A 1"]);
    const id = view(seen).products[0].id;
    expect(productDocs(seen, id)).toEqual([expect.objectContaining({ docNumber: "A 1", day: "2098-04-09", time: "09:05", quantity: 1 })]);
  });

  it("visibleLines: эрхийн хүрээнээс гадуурх болон хасагдсан хэлтэс орохгүй", () => {
    const lines = [line({ product: "Шон", quantity: 1 }), line({ product: "Хоол", quantity: 1, department: "Цайны газар", group: "Цайны газар" }), line({ product: "Дэр", quantity: 1, department: "Өөр", group: "Өөр" })];
    expect(visibleLines(lines, { departments: null }).map((l) => l.product)).toEqual(["Шон", "Дэр"]);
    expect(visibleLines(lines, { departments: ["тенсиланд хэсэг"] }).map((l) => l.product)).toEqual(["Шон"]);
  });

  it("клиентэд очих view дотор баримтын дугаар байхгүй", () => {
    const v = view([line({ product: "Шон", quantity: 1, docNumber: "СЭРГЭЭ-777" })]);
    expect(JSON.stringify(v)).not.toContain("СЭРГЭЭ-777");
  });
});
