import { describe, expect, it } from "vitest";
import { buildProductionView, isCostClosed, productDocs, type ProductionLedgerRow, type ProductionLineRow } from "./production-view";

const MONTH = "2098-04";
const TODAY = "2098-04-10";

let n = 0;
const line = (over: Partial<ProductionLineRow> & Pick<ProductionLineRow, "product" | "quantity">): ProductionLineRow => ({
  day: TODAY,
  docRef: `doc-${++n}`,
  docNumber: `ТЕН ${n}`,
  posted: true,
  stage: "finished",
  department: "Тенсиланд хэсэг",
  unit: "ш",
  ...over,
});
const out = (over: Partial<ProductionLedgerRow> & Pick<ProductionLedgerRow, "product" | "quantity" | "amount">): ProductionLedgerRow => ({ kind: "output", stage: "finished", department: "Тенсиланд хэсэг", unit: "ш", ...over });
const view = (lines: ProductionLineRow[], ledger: ProductionLedgerRow[] = [], over: { month?: string; scope?: { departments: string[] | null } } = {}) =>
  buildProductionView({ month: over.month ?? MONTH, current: MONTH, today: TODAY, lines, ledger, scope: over.scope });

describe("«Зас», «Брак» нэр", () => {
  it("«Зас» нэртэйг үндсэн бүтээгдэхүүнд нийлүүлж, задаргаанд «үүнээс засвар» гэж харуулна", () => {
    const v = view([line({ product: "Шон 80*80", quantity: 100 }), line({ product: "Шон 80*80 Зас", quantity: 5 }), line({ product: "шон 80*80 зас", quantity: 2 })]);
    expect(v.products).toHaveLength(1);
    expect(v.products[0]).toMatchObject({ name: "Шон 80*80", qty: 107, repairQty: 7, defect: false });
    expect(v.kpi.productTypes).toBe(1);
  });

  it("«Брак» тусдаа мөр (үндсэн мөрийн дараа), нийт гарцад ордоггүй, брак хувь = брак / (сайн + брак)", () => {
    const v = view([line({ product: "Шон 80*80", quantity: 90 }), line({ product: "Шон 80*80 Брак", quantity: 10 }), line({ product: "БУЗ суваг", quantity: 5 })]);
    expect(v.products.map((p) => [p.name, p.qty, p.defect])).toEqual([["Шон 80*80", 90, false], ["Шон 80*80 · Брак", 10, true], ["БУЗ суваг", 5, false]]);
    expect(v.kpi.month).toEqual([{ unit: "ширхэг", qty: 95 }]); // 90 + 5, бракгүй
    expect(v.kpi.defectPct).toBe(9.5); // 10 / (95 + 10)
    expect(v.kpi.defect).toEqual([{ unit: "ширхэг", qty: 10 }]);
  });

  it("брак бүртгэгдээгүй бол хувь null", () => {
    expect(view([line({ product: "Шон", quantity: 4 })]).kpi.defectPct).toBeNull();
  });
});

describe("батлагдаагүй баримт", () => {
  it("нийт дүнд орно, гэхдээ бүтээгдэхүүн, цех, график, KPI дээр тусад нь тэмдэглэгдэнэ", () => {
    const v = view([
      line({ product: "Шон", quantity: 100, docRef: "a" }),
      line({ product: "Шон", quantity: 50, docRef: "b", posted: false }),
      line({ product: "Шон Зас", quantity: 2, docRef: "b", posted: false }),
      line({ product: "Дэр", quantity: 7, docRef: "c", posted: false }),
    ]);
    expect(v.kpi.month).toEqual([{ unit: "ширхэг", qty: 159 }]);
    expect(v.kpi.unconfirmedDocs).toBe(2); // b, c (нэг баримтын хоёр мөр нэг л удаа)
    expect(v.kpi.unconfirmed).toEqual([{ unit: "ширхэг", qty: 59 }]);
    expect(v.products.find((p) => p.name === "Шон")).toMatchObject({ qty: 152, unconfirmedQty: 52 });
    expect(v.products.find((p) => p.name === "Дэр")).toMatchObject({ unconfirmedQty: 7 });
    expect(v.departments[0].unconfirmedDocs).toBe(2);
    expect(v.chart!.days.find((d) => d.date === TODAY)).toMatchObject({ confirmed: 100, unconfirmed: 59 });
  });

  it("бүгд батлагдсан бол тэмдэг, тоо 0", () => {
    const v = view([line({ product: "Шон", quantity: 3 })]);
    expect(v.kpi.unconfirmedDocs).toBe(0);
    expect(v.products[0].unconfirmedQty).toBe(0);
  });
});

describe("хагас боловсруулсан, бутлуур", () => {
  const lines = () => [
    line({ product: "Шон", quantity: 100 }),
    line({ product: "Каркас", quantity: 40, stage: "semi", department: "Арматурын хэсэг" }),
    line({ product: "Элс", quantity: 414.2, stage: "crusher", unit: "м3", department: "Бутлан ангилах үйлдвэр" }),
  ];

  it("хагас боловсруулсан нийт гарц, бүтээгдэхүүний төрөл, графикт ордоггүй, жагсаалтад «semi» шаттай", () => {
    const v = view(lines());
    expect(v.kpi.month).toEqual([{ unit: "ширхэг", qty: 100 }]);
    expect(v.kpi.productTypes).toBe(1);
    expect(v.chart!.days.find((d) => d.date === TODAY)!.confirmed).toBe(100);
    expect(v.products.map((p) => [p.name, p.stage])).toEqual([["Шон", "finished"], ["Каркас", "semi"]]);
  });

  it("зөвхөн хагас боловсруулсан гарцтай хэлтэс цехийн жагсаалтад ордоггүй (бэлэн гарцтай цех л)", () => {
    const v = view(lines());
    expect(v.departments.map((d) => d.name)).toEqual(["Тенсиланд хэсэг"]);
  });

  it("бутлуурын гарц цех, бүтээгдэхүүнд ордоггүй, тусдаа хэсэгт (өөрийн нэгжээр)", () => {
    const v = view(lines());
    expect(v.products.some((p) => p.name === "Элс")).toBe(false);
    expect(v.departments.some((d) => d.name.startsWith("Бутлан"))).toBe(false);
    expect(v.crusher).toMatchObject({ total: [{ unit: "шоо метр", qty: 414.2 }], today: [{ unit: "шоо метр", qty: 414.2 }] });
    expect(v.crusher!.products).toEqual([{ name: "Элс", unit: "м3", qty: 414.2, unconfirmedQty: 0 }]);
  });

  it("бутлуургүй сард crusher = null", () => {
    expect(view([line({ product: "Шон", quantity: 1 })]).crusher).toBeNull();
  });
});

describe("өнөөдөр, өдрийн график", () => {
  it("өнөөдрийн гарц тусдаа; график сарын 1-ээс өнөөдөр хүртэл; өнгөрсөн сард өнөөдөр байхгүй, график сарын эцэс хүртэл", () => {
    const rows = [line({ product: "Шон", quantity: 10 }), line({ product: "Шон", quantity: 4, day: "2098-04-02" })];
    const v = view(rows);
    expect(v.kpi.today).toEqual([{ unit: "ширхэг", qty: 10 }]);
    expect(v.today).toBe(TODAY);
    expect(v.chart!.days).toHaveLength(10);
    expect(v.chart!.days[1]).toMatchObject({ date: "2098-04-02", confirmed: 4 });

    const past = buildProductionView({ month: "2098-03", current: MONTH, today: TODAY, lines: [line({ product: "Шон", quantity: 4, day: "2098-03-02" })], ledger: [] });
    expect(past.today).toBeNull();
    expect(past.kpi.today).toEqual([]);
    expect(past.chart!.days).toHaveLength(31);
  });

  it("гарцгүй сар: empty", () => {
    const v = view([]);
    expect(v.empty).toBe(true);
    expect(v.chart).toBeNull();
    expect(v.products).toEqual([]);
  });
});

describe("өртөг: зөвхөн хаагдсан сард", () => {
  const lines = [line({ product: "Дэр", quantity: 10, day: "2098-03-05" }), line({ product: "Дэр Зас", quantity: 2, day: "2098-03-05" }), line({ product: "Шон", quantity: 100, day: "2098-03-06" })];

  it("isCostClosed: өнгөрсөн сар БА дүн нь төлөвлөсөн (тоо x 1 ₮) биш үед л", () => {
    expect(isCostClosed("2098-03", "2098-04", [{ kind: "output", quantity: 100, amount: 100 }])).toBe(false); // төлөвлөсөн
    expect(isCostClosed("2098-03", "2098-04", [{ kind: "output", quantity: 100, amount: 5_000_000 }])).toBe(true);
    expect(isCostClosed("2098-04", "2098-04", [{ kind: "output", quantity: 100, amount: 5_000_000 }])).toBe(false); // одоогийн сар хэзээ ч
    expect(isCostClosed("2098-03", "2098-04", [])).toBe(false);
    expect(isCostClosed("2098-03", "2098-04", [{ kind: "material", quantity: 0, amount: 9_000_000 }])).toBe(false); // материал өртөгт тооцогдохгүй
  });

  it("хаагдсан сар: бүтээгдэхүүн бүрийн өртөг, нэгж өртөг (засвар нийлсэн), нийт; нэгж үнэ нь 1 ₮ (төлөвлөсөн) бол харуулахгүй", () => {
    const v = view(lines, [out({ product: "Дэр", quantity: 10, amount: 1_000_000 }), out({ product: "Дэр Зас", quantity: 2, amount: 200_000 }), out({ product: "Шон", quantity: 100, amount: 100 })], { month: "2098-03" });
    expect(v.cost).toEqual({ closed: true, total: 1_200_100, message: null });
    expect(v.products.find((p) => p.name === "Дэр")!.cost).toEqual({ amount: 1_200_000, unitCost: 100_000 });
    expect(v.products.find((p) => p.name === "Шон")!.cost).toBeNull();
  });

  it("одоогийн сар: «Сар хаагдаагүй — өртөг тодорхойгүй», өртөг харагдахгүй (дүн нь ялгаатай байсан ч)", () => {
    const v = view(lines.map((l) => ({ ...l, day: TODAY })), [out({ product: "Дэр", quantity: 10, amount: 1_000_000 })]);
    expect(v.cost).toEqual({ closed: false, total: null, message: "Сар хаагдаагүй — өртөг тодорхойгүй" });
    expect(v.products.every((p) => p.cost === null)).toBe(true);
  });

  it("өнгөрсөн сар хараахан хаагдаагүй (бичилт төлөвлөсөн үнээр): өртөг тодорхойгүй", () => {
    const v = view(lines, [out({ product: "Дэр", quantity: 10, amount: 10 })], { month: "2098-03" });
    expect(v.cost.closed).toBe(false);
    expect(v.cost.message).toBe("Сар хаагдаагүй — өртөг тодорхойгүй");
  });

  it("өнгөрсөн сард бичилт огт татагдаагүй бол тусдаа мессеж", () => {
    expect(view(lines, [], { month: "2098-03" }).cost.message).toBe("Энэ сарын өртгийн бичилт татагдаагүй");
  });

  it("материалын зарцуулалт сарын дүнгээр, цехээр; хагас боловсруулсан бичилт өртгийн нийт дүнд орно, материал орохгүй", () => {
    const v = view(lines, [
      out({ product: "Дэр", quantity: 10, amount: 1_000 }),
      out({ product: "Каркас", quantity: 5, amount: 500, stage: "semi" }),
      { kind: "material", stage: "", department: "Арматурын хэсэг", product: "", unit: "", quantity: 0, amount: 4_000 },
      { kind: "material", stage: "", department: "Тенсиланд хэсэг", product: "", unit: "", quantity: 0, amount: 6_000 },
    ], { month: "2098-03" });
    expect(v.material).toEqual({ amount: 10_000, departments: [{ name: "Тенсиланд хэсэг", amount: 6_000 }, { name: "Арматурын хэсэг", amount: 4_000 }] });
    expect(v.cost.total).toBe(1_500);
    expect(view(lines).material).toBeNull();
  });
});

describe("эрхийн хүрээ (scope)", () => {
  const lines = [line({ product: "Шон", quantity: 100 }), line({ product: "Дэр", quantity: 30, department: "Төмөр бетон хийц эдлэлийн цех" }), line({ product: "Элс", quantity: 5, stage: "crusher", department: "Бутлан ангилах үйлдвэр" })];

  it("departments = null: бүх цех", () => {
    const v = view(lines);
    expect(v.departments.map((d) => d.name).sort()).toEqual(["Тенсиланд хэсэг", "Төмөр бетон хийц эдлэлийн цех"].sort());
    expect(v.crusher).not.toBeNull();
  });

  it("зөвхөн өөрийн цех: бусад цех, бутлуур, KPI-д нөлөөлөхгүй", () => {
    const v = view(lines, [out({ product: "Шон", quantity: 1, amount: 1 }), out({ product: "Дэр", quantity: 1, amount: 1, department: "Төмөр бетон хийц эдлэлийн цех" })], { scope: { departments: ["тенсиланд хэсэг"] } });
    expect(v.kpi.month).toEqual([{ unit: "ширхэг", qty: 100 }]);
    expect(v.products.map((p) => p.name)).toEqual(["Шон"]);
    expect(v.departments.map((d) => d.name)).toEqual(["Тенсиланд хэсэг"]);
    expect(v.crusher).toBeNull();
  });

  it("тохирох цех байхгүй (хоосон жагсаалт): юу ч харуулахгүй", () => {
    const v = view(lines, [], { scope: { departments: [] } });
    expect(v.empty).toBe(true);
    expect(v.products).toEqual([]);
    expect(v.departments).toEqual([]);
    expect(v.kpi.month).toEqual([]);
  });
});

describe("drill-down (баримтын жагсаалт)", () => {
  it("зөвхөн тухайн бүтээгдэхүүний (засвар нийлсэн) баримт, шинээс хуучин рүү; брак тусдаа", () => {
    const lines = [
      line({ product: "Шон", quantity: 1, day: "2098-04-01", docNumber: "A 1" }),
      line({ product: "Шон Зас", quantity: 2, day: "2098-04-03", docNumber: "A 3", posted: false }),
      line({ product: "Шон Брак", quantity: 3, day: "2098-04-02", docNumber: "A 2" }),
      line({ product: "Дэр", quantity: 9, docNumber: "B 1" }),
    ];
    const v = view(lines);
    const main = v.products.find((p) => p.name === "Шон")!;
    expect(productDocs(lines, main.id).map((d) => [d.docNumber, d.repair, d.posted])).toEqual([["A 3", true, false], ["A 1", false, true]]);
    const defect = v.products.find((p) => p.defect)!;
    expect(productDocs(lines, defect.id).map((d) => d.docNumber)).toEqual(["A 2"]);
    expect(productDocs(lines, "finished|Байхгүй|ш")).toEqual([]);
  });

  it("клиентэд очих харагдац (view) дотор баримтын дугаар байхгүй", () => {
    const v = view([line({ product: "Шон", quantity: 1, docNumber: "СЭРГЭЭ-777" })]);
    expect(JSON.stringify(v)).not.toContain("СЭРГЭЭ-777");
  });
});
