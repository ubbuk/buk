// «Үйлдвэрлэл» табын харагдац: Postgres-ийн мөрүүдээс (production-store.ts) өнөөдөр / сарын гарц, өдрөөр, бүтээгдэхүүнээр, цехээр, бутлуур, өртөг.
// Цэвэр функц (DB, 1С-д хандахгүй): тестлэхэд хялбар. Клиентэд зөвхөн үр дүн (ProductionView) очно; баримтын дугаар зөвхөн drill-down (productDocs).
//
//  * «Зас» нэртэйг үндсэн бүтээгдэхүүнд нийлүүлж («үүнээс засвар»), «Брак»-ыг тусдаа мөр болгоно. Нийт гарцад брак ордоггүй; брак хувь = брак / (сайн + брак).
//  * Гол тоо нь бэлэн бүтээгдэхүүн (1441). Хагас боловсруулсан (1431) бүтээгдэхүүний хүснэгтэд «Хагас» тэмдэгтэй, нийт гарцад ордоггүй.
//    Бутлан ангилах үйлдвэрийн гарц (1401) цехийн жагсаалтад ордоггүй, тусдаа «Бутлах үйлдвэр» хэсэгт. Бэлэн гарцгүй хэлтэс (зөвхөн хагас боловсруулсан) цехийн жагсаалтад ордоггүй.
//  * Баримтын Posted=false бол «Нягтлан батлаагүй»: нийт дүнд орно, гэхдээ тусад нь тоологдож тэмдэглэгдэнэ.
//  * Өртөг: сар хаагдсан үед л (isCostClosed). Хаагдаагүй сард Сумма нь төлөвлөсөн (нэгж үнэ 1 ₮) тул харуулахгүй.
import { addDays, monthRange } from "./dates";
import { normalizeDepartment, splitProductName, type ProductionStage } from "./production-names";
import { sumQuantities, type Quantity } from "@/lib/units";

export interface ProductionLineRow {
  day: string;
  docRef: string;
  docNumber: string;
  posted: boolean;
  stage: ProductionStage;
  department: string;
  product: string;
  unit: string;
  quantity: number;
}

export interface ProductionLedgerRow {
  kind: "output" | "material";
  stage: string;
  department: string;
  product: string;
  unit: string;
  quantity: number;
  amount: number;
}

/** departments = null: бүх цех. Бусад нь зөвхөн нэр нь (жигдэрсэн) жагсаалтад байгаа цех (BOSS-ийн өөрийн цех) */
export interface ProductionScope {
  departments: string[] | null;
}

export interface ProductRow {
  id: string;
  name: string;
  unit: string;
  stage: "finished" | "semi";
  defect: boolean;
  qty: number;
  repairQty: number;
  unconfirmedQty: number;
  cost: { amount: number; unitCost: number } | null;
}

export interface DepartmentRow {
  name: string;
  finished: Quantity[];
  semi: Quantity[];
  unconfirmedDocs: number;
  /** үндсэн нэгжээр, бүх цехийн дотор эзлэх хувь */
  share: number;
  materialAmount: number | null;
}

export interface CrusherProduct {
  name: string;
  unit: string;
  qty: number;
  unconfirmedQty: number;
}

export interface ProductionView {
  month: string;
  today: string | null;
  isCurrent: boolean;
  scopeNote: string | null;
  kpi: {
    today: Quantity[];
    month: Quantity[];
    productTypes: number;
    /** хувь (0..100); бракийн тоо бүртгэгдээгүй бол null */
    defectPct: number | null;
    defect: Quantity[];
    unconfirmedDocs: number;
    unconfirmed: Quantity[];
  };
  chart: { unit: string; days: { date: string; confirmed: number; unconfirmed: number }[] } | null;
  products: ProductRow[];
  departments: DepartmentRow[];
  crusher: { total: Quantity[]; today: Quantity[]; products: CrusherProduct[]; unconfirmedDocs: number } | null;
  cost: { closed: boolean; total: number | null; message: string | null };
  material: { amount: number; departments: { name: string; amount: number }[] } | null;
  lastSyncedAt: string | null;
  empty: boolean;
}

export interface DocLine {
  day: string;
  docNumber: string;
  department: string;
  quantity: number;
  unit: string;
  posted: boolean;
  repair: boolean;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;
const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Сар хаагдсан эсэх: өнгөрсөн сар БА бэлэн/хагас бүтээгдэхүүний бичилтийн дүн нь төлөвлөсөн (тоо x 1 ₮) биш.
 * Хаагдаагүй сард 1С бичилтийг төлөвлөсөн үнээр хийдэг тул Σдүн ≈ Σтоо; хаалтын дараа бодит өртөг орж, энэ нь тод зөрнө.
 */
export function isCostClosed(month: string, current: string, ledger: readonly Pick<ProductionLedgerRow, "kind" | "quantity" | "amount">[]): boolean {
  if (month >= current) return false;
  const out = ledger.filter((r) => r.kind === "output");
  if (!out.length) return false;
  const qty = out.reduce((s, r) => s + r.quantity, 0);
  const amount = out.reduce((s, r) => s + r.amount, 0);
  return Math.abs(amount - qty) > Math.max(1, qty * 0.001);
}

// Үндсэн нэрийг том/жижиг үсгээр ялгахгүй («Шон 80*80» ба «шон 80*80 зас» нэг бүтээгдэхүүн)
const keyOf = (stage: string, base: string, unit: string) => `${stage}|${base.toLowerCase()}|${unit}`;
/** Үйлдвэрлэл биш хэлтэс (жишээ цайны газар): нэрээр нь хасна. Гарц нь цехийн жагсаалт, бүтээгдэхүүн, нийт гарц, график, материалын аль нь ч-д орохгүй. */
export const PRODUCTION_EXCLUDED_DEPARTMENTS: readonly string[] = ["Цайны газар"];
const EXCLUDED = PRODUCTION_EXCLUDED_DEPARTMENTS.map(normalizeDepartment);
export const isExcludedDepartment = (department: string): boolean => EXCLUDED.includes(normalizeDepartment(department));

const inScope = (scope: ProductionScope, department: string) => !isExcludedDepartment(department) && (scope.departments === null || scope.departments.includes(normalizeDepartment(department)));

export function buildProductionView(input: {
  month: string;
  current: string;
  today: string;
  lines: readonly ProductionLineRow[];
  ledger: readonly ProductionLedgerRow[];
  scope?: ProductionScope;
  scopeNote?: string | null;
  lastSyncedAt?: string | null;
}): ProductionView {
  const { month, current, today } = input;
  const scope = input.scope ?? { departments: null };
  const lines = input.lines.filter((l) => inScope(scope, l.department));
  const ledger = input.ledger.filter((r) => inScope(scope, r.department));
  const isCurrent = month === current;

  const finished = lines.filter((l) => l.stage === "finished");
  const good = finished.filter((l) => splitProductName(l.product).variant !== "defect");
  const defect = finished.filter((l) => splitProductName(l.product).variant === "defect");
  const unconfirmedGood = good.filter((l) => !l.posted);

  // Үндсэн нэгж: гарцын хамгийн их нэгж (график, брак хувь, цехийн хувь үүгээр)
  const monthQty = sumQuantities(good.map((l) => ({ qty: l.quantity, unit: l.unit })));
  const primary = [...monthQty].sort((a, b) => b.qty - a.qty)[0]?.unit ?? "";
  const inPrimary = (l: ProductionLineRow) => sumQuantities([{ qty: l.quantity, unit: l.unit }])[0]?.unit === primary;
  const sumPrimary = (rows: readonly ProductionLineRow[]) => rows.filter(inPrimary).reduce((s, l) => s + l.quantity, 0);
  const goodP = sumPrimary(good);
  const defectP = sumPrimary(defect);
  const defectPct = defect.length && goodP + defectP > 0 ? Math.round((defectP / (goodP + defectP)) * 1000) / 10 : null;

  const qtyOf = (rows: readonly ProductionLineRow[]) => sumQuantities(rows.map((l) => ({ qty: l.quantity, unit: l.unit })));

  // ---- өдөр бүр (үндсэн нэгжээр)
  let chart: ProductionView["chart"] = null;
  if (primary) {
    const { from, to } = monthRange(month);
    const last = isCurrent && today < to ? today : to;
    const days: { date: string; confirmed: number; unconfirmed: number }[] = [];
    for (let d = from; d <= last; d = addDays(d, 1)) days.push({ date: d, confirmed: 0, unconfirmed: 0 });
    const at = new Map(days.map((d) => [d.date, d]));
    for (const l of good.filter(inPrimary)) {
      const d = at.get(l.day);
      if (d) d[l.posted ? "confirmed" : "unconfirmed"] += l.quantity;
    }
    for (const d of days) {
      d.confirmed = round3(d.confirmed);
      d.unconfirmed = round3(d.unconfirmed);
    }
    chart = { unit: primary, days };
  }

  // ---- бүтээгдэхүүнээр (бэлэн + хагас)
  interface Acc {
    row: ProductRow;
    base: string;
  }
  const acc = new Map<string, Acc>();
  const ensure = (stage: "finished" | "semi", base: string, unit: string, isDefect: boolean): ProductRow => {
    const id = `${keyOf(stage, base, unit)}${isDefect ? "|defect" : ""}`;
    let a = acc.get(id);
    if (!a) {
      a = { base, row: { id, name: isDefect ? `${base} · Брак` : base, unit, stage, defect: isDefect, qty: 0, repairQty: 0, unconfirmedQty: 0, cost: null } };
      acc.set(id, a);
    }
    return a.row;
  };
  for (const l of lines) {
    if (l.stage === "crusher") continue;
    const { base, variant } = splitProductName(l.product);
    const row = ensure(l.stage, base, l.unit, variant === "defect");
    row.qty += l.quantity;
    if (variant === "repair") row.repairQty += l.quantity;
    if (!l.posted) row.unconfirmedQty += l.quantity;
  }

  // ---- өртөг (зөвхөн хаагдсан сард)
  const closed = isCostClosed(month, current, ledger);
  if (closed) {
    const cost = new Map<string, { qty: number; amount: number }>();
    for (const r of ledger) {
      if (r.kind !== "output" || (r.stage !== "finished" && r.stage !== "semi")) continue;
      const { base, variant } = splitProductName(r.product);
      const id = `${keyOf(r.stage, base, r.unit)}${variant === "defect" ? "|defect" : ""}`;
      const c = cost.get(id) ?? { qty: 0, amount: 0 };
      c.qty += r.quantity;
      c.amount += r.amount;
      cost.set(id, c);
    }
    for (const [id, a] of acc) {
      const c = cost.get(id);
      // Нэгж өртөг ≈ 1 ₮ бол энэ бүтээгдэхүүний өртөг хараахан бодогдоогүй (төлөвлөсөн үнэ хэвээр): харуулахгүй
      if (c && c.qty > 0 && Math.abs(c.amount / c.qty - 1) > 0.005) a.row.cost = { amount: round2(c.amount), unitCost: round2(c.amount / c.qty) };
    }
  }
  const products: ProductRow[] = [];
  const mains = [...acc.values()].filter((a) => !a.row.defect).sort((a, b) => (a.row.stage === b.row.stage ? b.row.qty - a.row.qty : a.row.stage === "finished" ? -1 : 1));
  for (const m of mains) {
    products.push(roundRow(m.row));
    const d = acc.get(`${m.row.id}|defect`);
    if (d) products.push(roundRow(d.row));
  }
  for (const a of acc.values()) if (a.row.defect && !acc.has(a.row.id.replace(/\|defect$/, ""))) products.push(roundRow(a.row)); // үндсэн нь байхгүй брак

  // ---- цехээр (бутлуур орохгүй)
  // Цехийн жагсаалтад зөвхөн бэлэн бүтээгдэхүүний (1441) гарцтай цех: зөвхөн хагас боловсруулсан, бутлуурын гарцтай хэлтэс орохгүй
  const deptNames = [...new Set(lines.filter((l) => l.stage === "finished").map((l) => l.department))];
  const materialBy = new Map<string, number>();
  for (const r of ledger) if (r.kind === "material") materialBy.set(r.department, (materialBy.get(r.department) ?? 0) + r.amount);
  const departments: DepartmentRow[] = deptNames
    .map((name) => {
      const own = lines.filter((l) => l.department === name && l.stage !== "crusher");
      const ownGood = own.filter((l) => l.stage === "finished" && splitProductName(l.product).variant !== "defect");
      return {
        name,
        finished: qtyOf(ownGood),
        semi: qtyOf(own.filter((l) => l.stage === "semi")),
        unconfirmedDocs: new Set(own.filter((l) => !l.posted).map((l) => l.docRef)).size,
        share: goodP > 0 ? Math.round((sumPrimary(ownGood) / goodP) * 1000) / 10 : 0,
        materialAmount: materialBy.has(name) ? round2(materialBy.get(name)!) : null,
      };
    })
    .sort((a, b) => b.share - a.share || a.name.localeCompare(b.name, "mn"));

  // ---- бутлуур
  const crush = lines.filter((l) => l.stage === "crusher");
  let crusher: ProductionView["crusher"] = null;
  if (crush.length) {
    const by = new Map<string, CrusherProduct>();
    for (const l of crush) {
      const k = `${l.product}|${l.unit}`;
      const p = by.get(k) ?? { name: l.product, unit: l.unit, qty: 0, unconfirmedQty: 0 };
      p.qty += l.quantity;
      if (!l.posted) p.unconfirmedQty += l.quantity;
      by.set(k, p);
    }
    crusher = {
      total: qtyOf(crush),
      today: qtyOf(crush.filter((l) => l.day === today)),
      products: [...by.values()].map((p) => ({ ...p, qty: round3(p.qty), unconfirmedQty: round3(p.unconfirmedQty) })).sort((a, b) => b.qty - a.qty),
      unconfirmedDocs: new Set(crush.filter((l) => !l.posted).map((l) => l.docRef)).size,
    };
  }

  // ---- өртөг, материал
  const outputs = ledger.filter((r) => r.kind === "output" && (r.stage === "finished" || r.stage === "semi"));
  const total = closed ? round2(outputs.reduce((s, r) => s + r.amount, 0)) : null;
  const materials = ledger.filter((r) => r.kind === "material");
  const materialTotal = materials.reduce((s, r) => s + r.amount, 0);
  const material = materials.length ? { amount: round2(materialTotal), departments: [...materialBy].map(([name, amount]) => ({ name, amount: round2(amount) })).sort((a, b) => b.amount - a.amount) } : null;
  const costMessage = closed ? null : month < current && !outputs.length ? "Энэ сарын өртгийн бичилт татагдаагүй" : "Сар хаагдаагүй — өртөг тодорхойгүй";

  const unconfirmedDocs = new Set(lines.filter((l) => !l.posted).map((l) => l.docRef)).size;
  return {
    month,
    today: isCurrent ? today : null,
    isCurrent,
    scopeNote: input.scopeNote ?? null,
    kpi: {
      today: isCurrent ? qtyOf(good.filter((l) => l.day === today)) : [],
      month: monthQty,
      productTypes: new Set(good.filter((l) => l.stage === "finished").map((l) => splitProductName(l.product).base.toLowerCase())).size,
      defectPct,
      defect: qtyOf(defect),
      unconfirmedDocs,
      unconfirmed: qtyOf(unconfirmedGood),
    },
    chart,
    products,
    departments,
    crusher,
    cost: { closed, total, message: costMessage },
    material,
    lastSyncedAt: input.lastSyncedAt ?? null,
    empty: lines.length === 0,
  };
}

function roundRow(r: ProductRow): ProductRow {
  return { ...r, qty: round3(r.qty), repairQty: round3(r.repairQty), unconfirmedQty: round3(r.unconfirmedQty) };
}

/** Бүтээгдэхүүний мөрийн drill-down: баримтын жагсаалт (хамгийн доод түвшин: баримтын дугаар энд л харагдана) */
export function productDocs(lines: readonly ProductionLineRow[], id: string): DocLine[] {
  const defect = id.endsWith("|defect");
  const [stage, base, unit] = id.replace(/\|defect$/, "").split("|");
  return lines
    .filter((l) => {
      if (l.stage !== stage || l.unit !== unit) return false;
      const s = splitProductName(l.product);
      return s.base.toLowerCase() === base && (s.variant === "defect") === defect;
    })
    .map((l) => ({ day: l.day, docNumber: l.docNumber, department: l.department, quantity: l.quantity, unit: l.unit, posted: l.posted, repair: splitProductName(l.product).variant === "repair" }))
    .sort((a, b) => b.day.localeCompare(a.day) || a.docNumber.localeCompare(b.docNumber, "mn"));
}
