import { describe, expect, it } from "vitest";
import { buildDirectorView, buildWorkshopView, defectPercent, type ProductionLedgerRow, type ProductionLineRow } from "./production-view";

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
const view = (lines = base(), day: string | null = "2098-04-09", scope?: { departments: string[] | null }, lastReports?: { department: string; lastDay: string; firstDay?: string; recent: number }[]) =>
  buildDirectorView({ day, today: TODAY, lines, scope, lastReports });
const card = (v: ReturnType<typeof view>, name: string) => v.cards.find((c) => c.name === name)!;

describe("захирлын харагдац: өдрийн нийт", () => {
  it("нийт нэгж тусдаа (шоо метр ширхэгтэй нэмэгдэхгүй), хагас боловсруулсан орохгүй; бетон хийцэд зөвхөн Бэлэн (засвар, брак орохгүй)", () => {
    expect(view().total).toEqual([
      { unit: "шоо метр", qty: 40 }, // зөвхөн бутлуур; БАЗ-ын 50 орохгүй
      { unit: "ширхэг", qty: 1200 + 619 },
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
    expect(view().cards.map((c) => c.name)).toEqual(["Тенсиланд хэсэг", "Бетон дэрний хэсэг", "Бетон зуурмаг (БАЗ-3, БАЗ-4)", "Бутлан ангилах үйлдвэр", "Төмөр бетон хийц эдлэлийн цех", "Вольтамиксийн хэсэг", "Арматурын хэсэг", "Металл хийц"]);
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
  it("тохиргоогүй хэлтэс «Бусад» картанд; «Цайны газар» хасагдана", () => {
    const v = view([...base(), line({ product: "Х", quantity: 5, department: "Шинэ хэлтэс" }), line({ product: "Хоол", quantity: 999, department: "Цайны газар" })]);
    expect(v.cards.find((c) => c.name === "Бусад")?.day[0]?.qty).toBe(5);
    expect(v.total.find((q) => q.unit === "ширхэг")?.qty).toBe(1200 + 619 + 5);
  });
  it("бетон бус цехэд засвар үндсэн бүтээгдэхүүнд нийлсэн хэвээр (Металл хийц), брак жагсаалтад ордоггүй", () => {
    const v = view([line({ product: "Хаалга", quantity: 10, department: "Металл хийц үйлдвэрлэлийн цех" }), line({ product: "Хаалга Зас", quantity: 2, department: "Металл хийц үйлдвэрлэлийн цех" }), line({ product: "Хаалга Брак", quantity: 1, department: "Металл хийц үйлдвэрлэлийн цех" })]);
    const m = card(v, "Металл хийц");
    expect(m.concrete).toBe(false);
    expect(m.products).toEqual([{ name: "Хаалга", qty: 12, unit: "ш" }]);
    expect(m.dayCats).toBeNull();
    expect(m.defectPct).toBeNull();
  });
  it("хагас боловсруулсан цехийн гарц өөрийн нэгжээр (шоо метр)", () => {
    expect(card(view(), "Бетон зуурмаг (БАЗ-3, БАЗ-4)").day).toEqual([{ unit: "шоо метр", qty: 50 }]);
    expect(card(view(), "Бутлан ангилах үйлдвэр").day).toEqual([{ unit: "шоо метр", qty: 40 }]);
  });
});

describe("бетон хийцийн цех: Бэлэн | Засвар | Брак", () => {
  it("4 цех concrete, бусад нь биш", () => {
    const v = view();
    expect(v.cards.filter((c) => c.concrete).map((c) => c.name).sort()).toEqual(["Бетон дэрний хэсэг", "Вольтамиксийн хэсэг", "Тенсиланд хэсэг", "Төмөр бетон хийц эдлэлийн цех"].sort());
  });
  it("өдрийн том тоо = Бэлэн (засвар, брак тусдаа); брак хувь = брак / (бэлэн + засвар + брак)", () => {
    const c = card(view(), TEN);
    expect(c.day).toEqual([{ unit: "ширхэг", qty: 1200 }]);
    expect(c.dayCats).toEqual({ ready: 1200, repair: 100, defect: 30 });
    expect(c.defectPct).toBe(2.3); // 30 / 1330
    expect(c.top).toMatchObject({ name: "Шон 80*80", qty: 1200 });
  });
  it("бүтээгдэхүүн бүрийн мөрөнд 3 тоо (Бэлэн, Засвар, Брак)", () => {
    expect(card(view(), TEN).products).toEqual([{ name: "Шон 80*80", qty: 1200, unit: "ш", repair: 100, defect: 30 }]);
  });
  it("брак байхгүй бол хувь null (картад «Брак» гарахгүй)", () => {
    expect(card(view(), "Бетон дэрний хэсэг").defectPct).toBeNull();
    expect(card(view(), "Бетон дэрний хэсэг").dayCats).toEqual({ ready: 619, repair: 0, defect: 0 });
  });
  it("сарын нийт: Бэлэн, Засвар, Брак ба өдөр бүрийн ангилал (stacked график)", () => {
    const c = card(view(), TEN);
    expect(c.monthQty).toBe(1500);
    expect(c.monthCats).toEqual({ ready: 1500, repair: 100, defect: 30 });
    expect(c.monthDefectPct).toBe(1.8); // 30 / 1630
    expect(c.monthDaysCats.find((d) => d.date === "2098-04-09")).toMatchObject({ ready: 1200, repair: 100, defect: 30 });
    expect(c.monthDaysCats.find((d) => d.date === "2098-04-08")).toMatchObject({ ready: 300, repair: 0, defect: 0 });
    expect(c.monthProducts).toEqual([{ name: "Шон 80*80", qty: 1500, unit: "ш", repair: 100, defect: 30 }]);
  });
  it("бэлэн гарцгүй ч засвар/брак байвал өдөр «мэдээтэй» (0 бэлэн)", () => {
    const c = card(view([line({ product: "Шон Брак", quantity: 4 })]), TEN);
    expect(c.day).toEqual([{ unit: "ширхэг", qty: 0 }]);
    expect(c.dayCats).toEqual({ ready: 0, repair: 0, defect: 4 });
  });
  it("«(брак)» хаалттай нэр ч брак", () => {
    const c = card(view([line({ product: "Лоток Л-4 (брак)", quantity: 3 }), line({ product: "Лоток Л-4", quantity: 30 })]), TEN);
    expect(c.dayCats).toEqual({ ready: 30, repair: 0, defect: 3 });
  });
  it("defectPercent: нэг оронтой хувь", () => {
    expect(defectPercent({ ready: 90, repair: 8, defect: 2 })).toBe(2);
    expect(defectPercent({ ready: 1, repair: 0, defect: 0 })).toBeNull();
  });
});

describe("Дараа нь брак болсон (комплектац): тусдаа, давхар тоологдохгүй", () => {
  const rc = (qty: number, day: string, dept = TEN, product = "Шон 80*80 Брак") => line({ stage: "reclass", product, quantity: qty, day, department: dept });
  it("шилжүүлсэн өдрөөр өдөр ба сарын тоонд; гарц, брак хувь, нийтэд ордоггүй", () => {
    const lines = [...base(), rc(12, "2098-04-09"), rc(5, "2098-04-02")];
    const v = view(lines);
    const c = card(v, TEN);
    expect(c.lateDefectDay).toBe(12);
    expect(c.lateDefectMonth).toBe(17);
    expect(c.dayCats).toEqual({ ready: 1200, repair: 100, defect: 30 }); // өөрчлөгдөөгүй
    expect(c.day).toEqual([{ unit: "ширхэг", qty: 1200 }]);
    expect(v.total).toEqual(view().total);
    expect(card(view(lines, "2098-04-02"), TEN).lateDefectDay).toBe(5);
  });
  it("зөвхөн комплектацийн мөртэй өдөр цехийг «мэдээтэй» болгохгүй, мөн «Бусад» цех үүсгэхгүй", () => {
    const v = view([...base(), rc(8, "2098-04-06")], "2098-04-06");
    expect(card(v, TEN).day).toEqual([]);
    expect(card(v, TEN).lateDefectDay).toBe(8);
    expect(v.cards.some((c) => c.name === "Бусад")).toBe(false);
  });
  it("нягтлангийн харагдацын бүтээгдэхүүн/өдрийн задаргаа, сүүлийн өдөр (latestOutputDay)-д нөлөөгүй", () => {
    const only = [rc(8, "2098-04-09")];
    const v = view(only, null);
    expect(v.latestDay).toBeNull();
    expect(v.empty).toBe(false);
  });
});

describe("Бракаас / Засвараас бэлэн болгосон (комплектаци): гарцад нэмэгдэхгүй", () => {
  const cv = (stage: "defect_to_ready" | "repair_to_ready", qty: number, day: string, product = "Шон 80*80") => line({ stage, product, quantity: qty, day, department: TEN });
  const lines = () => [...base(), cv("defect_to_ready", 2113, "2098-04-09"), cv("repair_to_ready", 141, "2098-04-09"), cv("repair_to_ready", 6, "2098-04-09", "Дэр"), cv("defect_to_ready", 11, "2098-04-02")];

  it("өдөр: нийт ба бүтээгдэхүүнээр; сар: бүтээгдэхүүнээр ба өдрөөр", () => {
    const c = card(view(lines()), TEN);
    expect(c.convDay.fromDefect).toBe(2113);
    expect(c.convDay.fromRepair).toBe(147);
    expect(c.convDay.products).toEqual([
      { name: "Шон 80*80", unit: "ш", fromDefect: 2113, fromRepair: 141 },
      { name: "Дэр", unit: "ш", fromDefect: 0, fromRepair: 6 },
    ]);
    expect(c.convMonth.fromDefect).toBe(2124);
    expect(c.convMonth.fromRepair).toBe(147);
    expect(c.convDays).toEqual([
      { date: "2098-04-02", fromDefect: 11, fromRepair: 0 },
      { date: "2098-04-09", fromDefect: 2113, fromRepair: 147 },
    ]);
  });
  it("гарц, Бэлэн/Засвар/Брак, нийт, брак хувь, сарын нийтэд ОРОХГҮЙ (давхар тоолохгүй)", () => {
    const a = view(base());
    const b = view(lines());
    expect(b.total).toEqual(a.total);
    expect(card(b, TEN)).toMatchObject({ day: card(a, TEN).day, dayCats: card(a, TEN).dayCats, monthCats: card(a, TEN).monthCats, monthQty: card(a, TEN).monthQty, defectPct: card(a, TEN).defectPct, lateDefectDay: 0 });
    expect(card(b, TEN).products).toEqual(card(a, TEN).products);
  });
  it("шилжүүлэггүй цех/өдөр: 0, хоосон; зөвхөн шилжүүлэгтэй өдөр цехийг «мэдээтэй» болгохгүй", () => {
    expect(card(view(base()), TEN).convDay).toEqual({ fromDefect: 0, fromRepair: 0, products: [] });
    const v = view(lines(), "2098-04-06");
    expect(card(v, TEN).day).toEqual([]);
    expect(card(v, TEN).convMonth.fromDefect).toBe(2124);
  });
  it("сард гарц байхгүй ч (нэгж хоосон) шилжүүлэг, дараа нь брак тоологдоно", () => {
    const only = [cv("defect_to_ready", 2113, "2098-04-09"), line({ stage: "reclass", product: "Шон Брак", quantity: 3, day: "2098-04-09" })];
    const c = card(view(only), TEN);
    expect(c.convDay).toMatchObject({ fromDefect: 2113, fromRepair: 0 });
    expect(c.convMonth.fromDefect).toBe(2113);
    expect(c.lateDefectDay).toBe(3);
  });
  it("цехийн хуудсанд орно; BOSS өөр цехийн шилжүүлгийг харахгүй; нууцлал (баримтын дугаар ирэхгүй)", () => {
    const w = buildWorkshopView({ name: TEN, day: "2098-04-09", today: TODAY, lines: lines(), history: lines(), ledger: [] });
    expect(w.card!.convMonth.fromDefect).toBe(2124);
    expect(JSON.stringify(w)).not.toContain("СЕКРЕТ");
    expect(view(lines(), "2098-04-09", { departments: ["бусад хэлтэс"] }).cards).toEqual([]);
  });
});

describe("захирлын харагдац: сарын явц", () => {
  it("сарын нийт өдрөөс үл хамаарна (сонгосон өдрийн сар бүтнээрээ), өдөр бүрийн багана", () => {
    const c = card(view(), TEN);
    expect(c.month).toEqual([{ unit: "ширхэг", qty: 1500 }]);
    expect(c.unit).toBe("ширхэг");
    expect(c.monthDays).toHaveLength(10); // сарын эхнээс өнөөдөр (04-10) хүртэл
    expect(c.monthDays.find((d) => d.date === "2098-04-08")?.qty).toBe(300);
    expect(c.monthDays.find((d) => d.date === "2098-04-09")?.qty).toBe(1200);
  });
  it("өнгөрсөн сар сарын төгсгөл хүртэл", () => {
    const v = view([line({ product: "Шон", quantity: 3, day: "2098-02-27" })], "2098-02-27");
    expect(card(v, TEN).monthDays).toHaveLength(28);
  });
});

describe("мэдээ татагдаагүй өдөр (хуучин огноо)", () => {
  const reports = [{ department: TEN, lastDay: "2098-04-09", firstDay: "2098-03-01", recent: 3 }];
  it("хадгалагдсан хамгийн эртний өдрөөс өмнөх өдөр notLoaded, firstDay-тэй", () => {
    const v = view(base(), "2098-01-25", undefined, reports);
    expect(v.firstDay).toBe("2098-03-01");
    expect(v.notLoaded).toBe(true);
  });
  it("мэдээтэй хугацаанд notLoaded биш", () => {
    expect(view(base(), "2098-04-05", undefined, reports).notLoaded).toBe(false);
  });
});

describe("захирлын харагдац: эрх ба нууцлал", () => {
  it("BOSS зөвхөн өөрийн цехийн картыг харна (бусад цех, мэдээгүй цехүүд ч харагдахгүй)", () => {
    const v = view(base(), "2098-04-09", { departments: ["тенсиланд хэсэг"] });
    expect(v.cards.map((c) => c.name)).toEqual([TEN]);
    expect(v.total).toEqual([{ unit: "ширхэг", qty: 1200 }]);
  });
  it("хариуд баримтын дугаар, цаг, нягтлангийн төлөв, Комментарий ирэхгүй (Засвар, Брак зөвшөөрөгдсөн)", () => {
    const lines = [...base(), line({ product: "Шон", quantity: 1, posted: false })];
    const text = JSON.stringify(view(lines)) + JSON.stringify(buildWorkshopView({ name: TEN, day: "2098-04-09", today: TODAY, lines, history: lines, ledger: [] }));
    for (const bad of ["СЕКРЕТ", "11:33", "docRef", "posted", "unconfirmed", "Комментарий", "semi", "хагас", "Нягтлан", "docNumber"]) expect(text).not.toContain(bad);
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
    expect(w.card!.day).toEqual([{ unit: "ширхэг", qty: 1200 }]);
    expect(w.card!.monthQty).toBe(1500);
    expect(w.material).toEqual({ amount: 1500, items: [{ name: TEN, amount: 1500 }] });
  });
  it("сүүлийн 12 сар: өнөөдрийн сараас хойш, бетон хийцэд Бэлэн/Засвар/Брак ба 12 сарын брак хувь", () => {
    const hist = [...base(), line({ product: "Шон", quantity: 40, day: "2097-06-15" }), line({ product: "Шон Брак", quantity: 10, day: "2097-06-16" })];
    const w = ws(TEN, { history: hist });
    expect(w.monthsCats).toHaveLength(12);
    expect(w.monthsCats!.at(-1)).toEqual({ month: "2098-04", ready: 1500, repair: 100, defect: 30 });
    expect(w.monthsCats![0].month).toBe("2097-05");
    expect(w.monthsCats!.find((m) => m.month === "2097-06")).toMatchObject({ ready: 40, defect: 10 });
    expect(w.defectPct12).toBe(2.4); // 40 / 1680
    expect(w.months.at(-1)).toEqual({ month: "2098-04", qty: 1500 });
    expect(w.monthsUnit).toBe("ширхэг");
  });
  it("12 сар сонгосон өдрөөс үл хамаарна: хуучин өдөр сонговол ч сүүлийн 12 сар харагдана", () => {
    const w = ws(TEN, { day: "2097-07-25" });
    expect(w.monthsCats!.at(-1)).toMatchObject({ month: "2098-04", ready: 1500 });
    expect(w.card!.day).toEqual([]);
  });
  it("бетон бус цех: months = бэлэн гарц, monthsCats = null", () => {
    const w = ws(CRUSH);
    expect(w.monthsCats).toBeNull();
    expect(w.defectPct12).toBeNull();
    expect(w.months.at(-1)).toEqual({ month: "2098-04", qty: 40 });
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
    expect(ws("Бетон дэрний хэсэг", { scope }).card).toBeNull();
    expect(ws(TEN, { scope }).card).not.toBeNull();
  });
  it("байхгүй цех: card = null", () => {
    expect(ws("Байхгүй цех").card).toBeNull();
  });
  it("мэдээ татагдаагүй өдөр: notLoaded ба firstDay", () => {
    const w = ws(TEN, { day: "2097-07-25", lastReports: [{ department: TEN, lastDay: "2098-04-09", firstDay: "2098-04-08", recent: 2 }] });
    expect(w.notLoaded).toBe(true);
    expect(w.firstDay).toBe("2098-04-03"); // тайлангийн хамгийн эртний 04-08, мөрийн хамгийн эртний 04-03
  });
});
