import { describe, expect, it } from "vitest";
import { buildDirectorView, buildWorkshopView, type ProductionLedgerRow, type ProductionLineRow } from "./production-view";

const TODAY = "2098-04-10";
const RAIL = "Төмөр замын төмөр бетон дэрний хэсэг";
const TEN = "Тенсиланд хэсэг";
const BAZ = "БАЗ-3";
const CRUSH = "Бутлан ангилах үйлдвэр";

let n = 0;
const line = (over: Partial<ProductionLineRow> & Pick<ProductionLineRow, "product" | "quantity">): ProductionLineRow => ({
  day: "2098-04-09",
  docRef: `doc-${++n}`,
  docNumber: `СЕКРЕТ-${n}`,
  docTime: "11:33",
  posted: true,
  stage: "finished",
  department: TEN,
  unit: "ш",
  ...over,
});

const base = () => [
  line({ product: "Шон 80*80", quantity: 1200 }),
  line({ product: "Шон 80*80 Зас", quantity: 100 }),
  line({ product: "Шон 80*80 Брак", quantity: 30 }),
  line({ product: "Дэр", quantity: 619, department: RAIL }),
  line({ product: "Бетон", quantity: 50, department: BAZ, stage: "semi", unit: "м3" }),
  line({ product: "Хайрга 5-10", quantity: 40, department: CRUSH, stage: "crusher", unit: "м3" }),
  line({ product: "Шон 80*80", quantity: 300, day: "2098-04-08" }),
  line({ product: "Дэр", quantity: 7, department: RAIL, day: "2098-04-03" }),
];
const view = (lines = base(), day: string | null = "2098-04-09", scope?: { departments: string[] | null }, lastReports?: { department: string; lastDay: string; recent: number }[]) =>
  buildDirectorView({ day, today: TODAY, lines, scope, lastReports });
const card = (v: ReturnType<typeof view>, name: string) => v.cards.find((c) => c.name === name)!;

describe("захирлын харагдац: өдрийн нийт", () => {
  it("нийт нэгж тусдаа (шоо метр ширхэгтэй нэмэгдэхгүй), хагас боловсруулсан орохгүй, засвар нэгдэнэ, брак орохгүй", () => {
    const v = view();
    expect(v.total).toEqual([
      { unit: "шоо метр", qty: 40 }, // зөвхөн бутлуур; БАЗ-ын 50 орохгүй
      { unit: "ширхэг", qty: 1200 + 100 + 619 },
    ]);
  });
  it("ажилласан цехийн тоо (гарцтай цехүүд, БАЗ-ыг оролцуулан)", () => {
    expect(view().worked).toBe(4);
  });
  it("өдөр өгөөгүй бол гарцтай хамгийн сүүлийн өдөр", () => {
    const v = view(base(), null);
    expect(v.day).toBe("2098-04-09");
    expect(v.latestDay).toBe("2098-04-09");
  });
  it("ирээдүй өдөр өгвөл анхдагч өдөр; мэдээгүй өдөр хоосон нийттэй", () => {
    expect(view(base(), "2099-01-01").day).toBe("2098-04-09");
    const v = view(base(), "2098-04-05");
    expect(v.total).toEqual([]);
    expect(v.worked).toBe(0);
  });
});

describe("захирлын харагдац: цехийн картууд", () => {
  it("бүх тохиргооны цех харагдана; гарцтай нь эхэнд (их тоогоор), мэдээгүй нь сүүлд тохиргооны дарааллаар", () => {
    const v = view();
    expect(v.cards.map((c) => c.name)).toEqual(["Тенсиланд хэсэг", "Бетон дэрний хэсэг", "Бетон зуурмаг (БАЗ-3, БАЗ-4)", "Бутлан ангилах үйлдвэр", "Төмөр бетон хийц эдлэлийн цех", "Вольтамиксийн хэсэг", "Арматурын хэсэг", "Металл хийц"]);
  });
  it("мэдээгүй цех: өдрийн гарц хоосон, «Сүүлд» = өмнөх гарцтай өдөр", () => {
    const v = view();
    const rail = view(base(), "2098-04-05");
    expect(card(v, "Арматурын хэсэг").day).toEqual([]);
    expect(card(v, "Арматурын хэсэг").lastDay).toBeNull();
    expect(card(rail, "Бетон дэрний хэсэг").day).toEqual([]);
    expect(card(rail, "Бетон дэрний хэсэг").lastDay).toBe("2098-04-03");
  });
  it("мэдээгүй цехийн «Сүүлд» тайлангийн хүснэгтээс (сонгосон өдрөөс ихгүй бол)", () => {
    const v = view(base(), "2098-04-09", undefined, [{ department: "Металл хийц үйлдвэрлэлийн цех", lastDay: "2098-03-03", recent: 0 }]);
    expect(card(v, "Металл хийц").lastDay).toBe("2098-03-03");
  });
  it("бүтээгдэхүүн: засвар үндсэндээ нийлнэ, брак жагсаалтад ордоггүй; гол бүтээгдэхүүн = хамгийн их", () => {
    const c = card(view(), TEN);
    expect(c.products).toEqual([{ name: "Шон 80*80", qty: 1300, unit: "ш" }]);
    expect(c.top).toEqual({ name: "Шон 80*80", qty: 1300, unit: "ш" });
    expect(c.day).toEqual([{ unit: "ширхэг", qty: 1300 }]);
  });
  it("хагас боловсруулсан цехийн гарц өөрийн картанд өөрийн нэгжээр (шоо метр)", () => {
    expect(card(view(), "Бетон зуурмаг (БАЗ-3, БАЗ-4)").day).toEqual([{ unit: "шоо метр", qty: 50 }]);
    expect(card(view(), "Бутлан ангилах үйлдвэр").day).toEqual([{ unit: "шоо метр", qty: 40 }]);
  });
  it("тохиргоогүй хэлтэс «Бусад» картанд", () => {
    const v = view([...base(), line({ product: "Х", quantity: 5, department: "Шинэ хэлтэс" })]);
    expect(v.cards.some((c) => c.name === "Бусад" && c.day[0]?.qty === 5)).toBe(true);
  });
  it("«Цайны газар» хасагдана", () => {
    const v = view([...base(), line({ product: "Хоол", quantity: 999, department: "Цайны газар" })]);
    expect(v.cards.some((c) => c.name === "Бусад")).toBe(false);
    expect(v.total.find((q) => q.unit === "ширхэг")?.qty).toBe(1919);
  });
});

describe("захирлын харагдац: сарын явц", () => {
  it("сарын нийт өдрөөс үл хамаарна (сонгосон өдрийн сар бүтнээрээ), өдөр бүрийн багана", () => {
    const c = card(view(), TEN);
    expect(c.month).toEqual([{ unit: "ширхэг", qty: 1600 }]);
    expect(c.monthQty).toBe(1600);
    expect(c.unit).toBe("ширхэг");
    expect(c.monthDays).toHaveLength(10); // сарын эхнээс өнөөдөр (04-10) хүртэл
    expect(c.monthDays.find((d) => d.date === "2098-04-08")?.qty).toBe(300);
    expect(c.monthDays.find((d) => d.date === "2098-04-09")?.qty).toBe(1300);
    expect(c.monthProducts).toEqual([{ name: "Шон 80*80", qty: 1600, unit: "ш" }]);
  });
  it("өнгөрсөн сар сарын төгсгөл хүртэл", () => {
    const v = view([line({ product: "Шон", quantity: 3, day: "2098-02-27" })], "2098-02-27");
    expect(card(v, TEN).monthDays).toHaveLength(28);
  });
});

describe("захирлын харагдац: эрх ба нууцлал", () => {
  it("BOSS зөвхөн өөрийн цехийн картыг харна (бусад цех, мэдээгүй цехүүд ч харагдахгүй)", () => {
    const v = view(base(), "2098-04-09", { departments: ["тенсиланд хэсэг"] });
    expect(v.cards.map((c) => c.name)).toEqual([TEN]);
    expect(v.total).toEqual([{ unit: "ширхэг", qty: 1300 }]);
  });
  it("хариуд баримтын дугаар, цаг, нягтлангийн төлөв, Комментарий, брак, засвар ирэхгүй", () => {
    const lines = [...base(), line({ product: "Шон", quantity: 1, posted: false })];
    const text = JSON.stringify(view(lines)) + JSON.stringify(buildWorkshopView({ name: TEN, day: "2098-04-09", today: TODAY, lines, history: lines, ledger: [] }));
    for (const bad of ["СЕКРЕТ", "11:33", "docRef", "posted", "unconfirmed", "Комментарий", "Брак", "Зас", "semi", "хагас", "засвар", "Нягтлан"]) expect(text).not.toContain(bad);
  });
});

describe("цехийн хуудас", () => {
  const ledger: ProductionLedgerRow[] = [
    { kind: "material", stage: "", department: TEN, product: "", unit: "", quantity: 0, amount: 1500 },
    { kind: "material", stage: "", department: RAIL, product: "", unit: "", quantity: 0, amount: 700 },
  ];
  const ws = (name: string, over: Partial<Parameters<typeof buildWorkshopView>[0]> = {}) => buildWorkshopView({ name, day: "2098-04-09", today: TODAY, lines: base(), history: base(), ledger, ...over });

  it("өдөр, сар, бүтээгдэхүүн, цехийн материал (зөвхөн тэр цехийнх)", () => {
    const w = ws(TEN);
    expect(w.card!.day).toEqual([{ unit: "ширхэг", qty: 1300 }]);
    expect(w.card!.monthQty).toBe(1600);
    expect(w.material).toEqual({ amount: 1500, items: [{ name: TEN, amount: 1500 }] });
  });
  it("сүүлийн 12 сар: 12 бичлэг, сонгосон сар төгсгөл, нэгж цехийнх", () => {
    const hist = [...base(), line({ product: "Шон", quantity: 40, day: "2097-06-15" })];
    const w = ws(TEN, { history: hist });
    expect(w.months).toHaveLength(12);
    expect(w.months.at(-1)).toEqual({ month: "2098-04", qty: 1600 });
    expect(w.months[0].month).toBe("2097-05");
    expect(w.months.find((m) => m.month === "2097-06")?.qty).toBe(40);
    expect(w.monthsUnit).toBe("ширхэг");
  });
  it("нэгж цехээр: бутлуур, БАЗ шоо метр", () => {
    expect(ws(CRUSH).card!.unit).toBe("шоо метр");
    expect(ws("Бетон зуурмаг (БАЗ-3, БАЗ-4)").card!.unit).toBe("шоо метр");
    expect(ws("Бетон зуурмаг (БАЗ-3, БАЗ-4)").card!.day).toEqual([{ unit: "шоо метр", qty: 50 }]);
  });
  it("мэдээгүй цех: card байгаа, өдрийн гарц хоосон; материалгүй бол null", () => {
    const w = ws("Металл хийц");
    expect(w.card!.day).toEqual([]);
    expect(w.material).toBeNull();
  });
  it("BOSS өөр цехийн хуудсыг харахгүй (card = null)", () => {
    const scope = { departments: ["тенсиланд хэсэг"] };
    expect(ws(RAIL, { scope }).card).toBeNull();
    expect(ws("Бетон дэрний хэсэг", { scope }).card).toBeNull();
    expect(ws(TEN, { scope }).card).not.toBeNull();
  });
  it("байхгүй цех: card = null", () => {
    expect(ws("Байхгүй цех").card).toBeNull();
  });
});
