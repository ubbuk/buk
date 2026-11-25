// «Үйлдвэрлэл» табын харагдац: Postgres-ийн мөрүүдээс (production-store.ts) өнөөдөр / сарын гарц, өдрөөр, бүтээгдэхүүнээр, цехээр, бутлуур, өртөг.
// Цэвэр функц (DB, 1С-д хандахгүй): тестлэхэд хялбар. Клиентэд зөвхөн үр дүн (ProductionView) очно; баримтын дугаар зөвхөн drill-down (productDocs).
//
//  * «Зас» нэртэйг үндсэн бүтээгдэхүүнд нийлүүлж («үүнээс засвар»), «Брак»-ыг тусдаа мөр болгоно. Нийт гарцад брак ордоггүй; брак хувь = брак / (сайн + брак).
//  * Гол тоо нь бэлэн бүтээгдэхүүн (1441). Хагас боловсруулсан (1431) бүтээгдэхүүний хүснэгтэд «Хагас» тэмдэгтэй, нийт гарцад ордоггүй.
//    Бутлан ангилах үйлдвэрийн гарц (1401) цехийн жагсаалтад ордоггүй, тусдаа «Бутлах үйлдвэр» хэсэгт. Бэлэн гарцгүй хэлтэс (зөвхөн хагас боловсруулсан) цехийн жагсаалтад ордоггүй.
//  * Баримтын Posted=false бол «Нягтлан батлаагүй»: нийт дүнд орно, гэхдээ тусад нь тоологдож тэмдэглэгдэнэ.
//  * Өртөг: сар хаагдсан үед л (isCostClosed). Хаагдаагүй сард Сумма нь төлөвлөсөн (нэгж үнэ 1 ₮) тул харуулахгүй.
import { addDays, addMonths, monthRange } from "./dates";
import { groupFor, groupRank, isSemiGroup, OTHER_GROUP } from "./production-groups";
import { daysOfMonth } from "./production-month";
import { normalizeDepartment, splitProductName, type ProductionStage } from "./production-names";
import { sumQuantities, type Quantity } from "@/lib/units";

export interface ProductionLineRow {
  day: string;
  docRef: string;
  docNumber: string;
  /** баримтын цаг «ЦЦ:ММ» (drill-down) */
  docTime?: string;
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
  stage: "finished" | "semi" | "crusher";
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

/** Хэлтэс сүүлд тайлан бичсэн өдөр (бүх хадгалагдсан сараас) ба сүүлийн 30 хоногт бичсэн тайлангийн (баримтын) тоо */
export interface ReportInfo {
  department: string;
  lastDay: string;
  /** өнөөдрөөс өмнөх 30 хоногт (өнөөдөр орно) бичигдсэн тайлан (баримт) */
  recent: number;
}

/** «Тайлан хоцорч байна?»: сүүлийн 30 хоногт LAG_MIN_REPORTS+ тайлантай (идэвхтэй) цех сүүлийн LAG_DAYS хоногт тайлангүй. Бусад тохиолдолд анхааруулга байхгүй. */
export const LAG_WINDOW_DAYS = 30;
export const LAG_MIN_REPORTS = 5;
export const LAG_DAYS = 7;

/** Нэг цех (тохиргооны карт, production-groups.ts): хураангуй хүснэгтийн мөр, бүтээгдэхүүн × цех хүснэгтийн хэсэг */
export interface ProductionCard {
  name: string;
  /** карт дотор нэгтгэгдсэн 1С-ийн хэлтсүүд (өгөгдөлтэй) */
  departments: string[];
  /** гарц нь хагас боловсруулсан (м3 бетон зуурмаг г.м.) */
  semi: boolean;
  /** тохиргоонд байхгүй хэлтсийн «Бусад» карт */
  unconfigured: boolean;
  /** энэ сар (өнөөдрийн сарын эхнээс өнөөдөр хүртэл) */
  month: Quantity[];
  /** сүүлийн 7 хоног (өнөөдөр орно) */
  week: Quantity[];
  /** сонгосон хугацаа */
  period: Quantity[];
  /** сонгосон хугацааны гарцын нийлбэр (эрэмбэлэхэд; нэгж холилдсон) */
  periodTotal: number;
  unconfirmedDocs: number;
  /** сонгосон хугацааны бүтээгдэхүүн бүрийн гарц */
  products: ProductRow[];
  /** хураангуйн «Гол бүтээгдэхүүн»: сонгосон хугацаанд хамгийн их гарсан (бракгүй) */
  top: { name: string; qty: number; unit: string } | null;
  /** сонгосон хугацаанд гарцгүй */
  empty: boolean;
  /** хамгийн сүүлийн тайлан (1С-д бичсэн өдөр) */
  lastReport: { day: string; daysAgo: number } | null;
  /** сүүлийн 30 хоногийн тайлангийн тоо */
  recentReports: number;
  /** «Тайлан хоцорч байна?» (LAG_MIN_REPORTS+ тайлантай идэвхтэй цех LAG_DAYS хоногт тайлангүй) */
  lagging: boolean;
}

/** «Цех × Өдөр» хүснэгтийн нүд: тухайн өдрийн бэлэн гарц (нэгж бүр тусдаа), нягтлан батлаагүй баримт орсон эсэх */
export interface GridCell {
  qty: Quantity[];
  unconfirmed: boolean;
}

export interface GridRow {
  name: string;
  /** хагас боловсруулсан цех (БАЗ, Арматур): мөрөнд харагдана, «Өдрийн нийт»-д ордоггүй */
  semi: boolean;
  unconfigured: boolean;
  lastReport: { day: string; daysAgo: number } | null;
  lagging: boolean;
  /** сүүлийн 30 хоногийн тайлангийн тоо */
  recentReports: number;
  /** сард гарцгүй (мөр доор, саарал) */
  idle: boolean;
  /** сарын өдөр бүр (days-тэй ижил индекс); гарцгүй өдөр null */
  cells: (GridCell | null)[];
  /** «Сарын нийт» */
  total: Quantity[];
}

/** Мөр = цех (production-groups), багана = сарын өдрүүд, нүд = өдрийн бэлэн гарц. Доод мөр = өдрийн нийт: нэгж бүр тусдаа (м3-ийг ширхэгтэй нэмэхгүй), хагас боловсруулсан цех орохгүй. */
export interface ProductionGrid {
  days: string[];
  rows: GridRow[];
  totals: { days: (GridCell | null)[]; month: Quantity[] };
}

export interface ProductionView {
  grid: ProductionGrid;
  month: string;
  /** жинхэнэ өнөөдөр (YYYY-MM-DD) */
  todayDate: string;
  period: { from: string; to: string };
  /** сонгосон цех (эх хэлтэс), үгүй бол null = бүх цех */
  group: string | null;
  /** «Бүх цех ▾» шүүлтүүрийн сонголтууд (картуудын нэр) */
  groups: string[];
  cards: ProductionCard[];
  /** сүүлийн 12 сарын гарц (сонгосон цехээр, үгүй бол нийт бэлэн бүтээгдэхүүн): сар = тайлан бичсэн өдрийн сар */
  monthly: { unit: string; months: { month: string; confirmed: number; unconfirmed: number }[] } | null;
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
  /** өдөр бүрийн гарц; byGroup = цех (карт) бүрийн хувь нэмэр (stacked график), groups = графикт орсон цехүүд (тохиргооны дарааллаар) */
  chart: { unit: string; groups: string[]; days: { date: string; confirmed: number; unconfirmed: number; byGroup: Record<string, number> }[] } | null;
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
  /** баримтын цаг «ЦЦ:ММ» */
  time: string;
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

/** Хэлтэс -> картын нэр (тохиргоо, давхардсан нэр нэгдэнэ; тохиргоогүй бол «Бусад») */
const groupOf = (r: { department: string }): string => groupFor(r.department).name;
const variantOf = (l: ProductionLineRow) => splitProductName(l.product).variant;
/** Карт, тоонд орох гарц: бэлэн бүтээгдэхүүний сайн гарц ба бутлуурын гарц (брак, хагас боловсруулсан орохгүй) */
const isOutput = (l: ProductionLineRow) => l.stage === "crusher" || (l.stage === "finished" && variantOf(l) !== "defect");
/** Картын гарц: дээрхээс гадна хагас боловсруулсан картад (бетон зуурмаг) 1431-ийн гарц ордог */
const isCardOutput = (l: ProductionLineRow, semi: boolean) => isOutput(l) || (semi && l.stage === "semi" && variantOf(l) !== "defect");
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

interface Acc {
  row: ProductRow;
  base: string;
}

/** Бүтээгдэхүүн бүрийн нэгтгэл: «Зас» үндсэн нэрт нийлнэ, «Брак» тусдаа мөр */
function aggregate(rows: readonly ProductionLineRow[], includeCrusher: boolean): Map<string, Acc> {
  const acc = new Map<string, Acc>();
  for (const l of rows) {
    if (l.stage === "crusher" && !includeCrusher) continue;
    const { base, variant } = splitProductName(l.product);
    const isDefect = variant === "defect";
    const id = `${keyOf(l.stage, base, l.unit)}${isDefect ? "|defect" : ""}`;
    let a = acc.get(id);
    if (!a) {
      a = { base, row: { id, name: isDefect ? `${base} · Брак` : base, unit: l.unit, stage: l.stage, defect: isDefect, qty: 0, repairQty: 0, unconfirmedQty: 0, cost: null } };
      acc.set(id, a);
    }
    if (variant === "main") a.row.name = base; // «Зас»-ын нэр биш, үндсэн нэрийн бичлэгийг ав
    a.row.qty += l.quantity;
    if (variant === "repair") a.row.repairQty += l.quantity;
    if (!l.posted) a.row.unconfirmedQty += l.quantity;
  }
  return acc;
}

const STAGE_RANK = { finished: 0, crusher: 1, semi: 2 } as const;

/** Дараалал: шат (бэлэн, бутлуур, хагас), дотроо тоогоор буурахаар; брак нь үндсэн мөрийнхөө ДАРАА */
function orderProducts(acc: Map<string, Acc>): ProductRow[] {
  const out: ProductRow[] = [];
  const mains = [...acc.values()].filter((a) => !a.row.defect).sort((a, b) => (a.row.stage === b.row.stage ? b.row.qty - a.row.qty : STAGE_RANK[a.row.stage] - STAGE_RANK[b.row.stage]));
  for (const m of mains) {
    out.push(roundRow(m.row));
    const d = acc.get(`${m.row.id}|defect`);
    if (d) out.push(roundRow(d.row));
  }
  for (const a of acc.values()) if (a.row.defect && !acc.has(a.row.id.replace(/\|defect$/, ""))) out.push(roundRow(a.row)); // үндсэн нь байхгүй брак
  return out;
}

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
  /** сонгосон хугацаа (YYYY-MM-DD); өгөөгүй бол `month` бүтнээрээ. Өнөөдрийн тоо, график нь `month`-оор. */
  from?: string;
  to?: string;
  /** сонгосон цех (картын нэр); үгүй бол бүх цех */
  group?: string | null;
  /** хэлтэс бүрийн сүүлийн тайлан (бүх хадгалагдсан сараас): картын «Сүүлийн тайлан», хоцролт */
  lastReports?: readonly ReportInfo[];
  /** сүүлийн 12 сарын мөрүүд (12 сарын график); өгөөгүй бол `lines` */
  history?: readonly ProductionLineRow[];
}): ProductionView {
  const { month, current, today } = input;
  const scope = input.scope ?? { departments: null };
  const scoped = input.lines.filter((l) => inScope(scope, l.department));
  const scopedLedger = input.ledger.filter((r) => inScope(scope, r.department));
  // Картууд: тохиргооны хэлтсүүдээс өгөгдөлтэй (энэ сарын мөр эсвэл хэзээ нэгэн тайлантай) нь, дарааллаар; тохиргоогүй хэлтэс «Бусад» картанд
  const reports = (input.lastReports ?? []).filter((r) => inScope(scope, r.department));
  const groups = [...new Set([...scoped.map(groupOf), ...reports.map(groupOf)])].sort((a, b) => groupRank(a) - groupRank(b) || a.localeCompare(b, "mn"));
  const group = input.group && groups.includes(input.group) ? input.group : null;
  const allLines = scoped.filter((l) => group === null || groupOf(l) === group);
  const ledger = scopedLedger.filter((r) => group === null || groupOf(r) === group);
  const full = monthRange(month);
  const range = { from: input.from ?? full.from, to: input.to ?? full.to };
  const inRange = (l: ProductionLineRow) => l.day >= range.from && l.day <= range.to;
  const lines = allLines.filter(inRange);
  const isCurrent = month === current;

  const finished = lines.filter((l) => l.stage === "finished");
  const good = finished.filter((l) => splitProductName(l.product).variant !== "defect");
  const defect = finished.filter((l) => splitProductName(l.product).variant === "defect");
  const unconfirmedGood = good.filter((l) => !l.posted);

  // Үндсэн нэгж: гарцын хамгийн их нэгж (график, брак хувь, цехийн хувь үүгээр)
  const monthQty = sumQuantities(good.map((l) => ({ qty: l.quantity, unit: l.unit })));
  const monthGood = allLines.filter((l) => l.day.startsWith(month) && l.stage === "finished" && variantOf(l) !== "defect");
  const chartQty = sumQuantities(monthGood.map((l) => ({ qty: l.quantity, unit: l.unit })));
  const primary = [...(chartQty.length ? chartQty : monthQty)].sort((a, b) => b.qty - a.qty)[0]?.unit ?? "";
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
    const days: { date: string; confirmed: number; unconfirmed: number; byGroup: Record<string, number> }[] = [];
    for (let d = from; d <= last; d = addDays(d, 1)) days.push({ date: d, confirmed: 0, unconfirmed: 0, byGroup: {} });
    const at = new Map(days.map((d) => [d.date, d]));
    for (const l of allLines.filter((x) => x.stage === "finished" && variantOf(x) !== "defect" && inPrimary(x))) {
      const d = at.get(l.day);
      if (d) {
        d[l.posted ? "confirmed" : "unconfirmed"] += l.quantity;
        const g = groupOf(l);
        d.byGroup[g] = (d.byGroup[g] ?? 0) + l.quantity;
      }
    }
    for (const d of days) {
      d.confirmed = round3(d.confirmed);
      d.unconfirmed = round3(d.unconfirmed);
      for (const g of Object.keys(d.byGroup)) d.byGroup[g] = round3(d.byGroup[g]);
    }
    const chartGroups = [...new Set(days.flatMap((d) => Object.keys(d.byGroup)))].sort((a, b) => groupRank(a) - groupRank(b));
    chart = { unit: primary, groups: chartGroups, days };
  }

  // ---- бүтээгдэхүүнээр (бэлэн + хагас)
  const acc = aggregate(lines, false);

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
  const products = orderProducts(acc);

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

  // ---- цех бүрийн карт (тохиргоогоор)
  const monthStart = `${today.slice(0, 7)}-01`;
  const weekStart = addDays(today, -6);
  const lagStart = addDays(today, -(LAG_WINDOW_DAYS - 1));
  const cards: ProductionCard[] = groups.map((name) => {
    const semi = isSemiGroup(name);
    const mine = scoped.filter((l) => groupOf(l) === name);
    const rep = reports.filter((r) => groupOf(r) === name);
    const period = mine.filter(inRange);
    const outRows = (rows: readonly ProductionLineRow[]) => rows.filter((l) => isCardOutput(l, semi));
    const out = (rows: readonly ProductionLineRow[]) => qtyOf(outRows(rows));
    const lastDay = [...rep.map((r) => r.lastDay), ...mine.map((l) => l.day)].reduce<string | null>((best, d) => (best === null || d > best ? d : best), null);
    const daysAgo = lastDay ? Math.max(0, dayDiff(lastDay, today)) : null;
    // Сүүлийн 30 хоногийн тайлан: DB-ийн тоо (бүх сар), нөгөө талаас ачаалагдсан мөрийн давхардаагүй баримт: их нь
    const recentReports = Math.max(rep.reduce((sum, r) => sum + r.recent, 0), new Set(mine.filter((l) => l.day >= lagStart && l.day <= today).map((l) => l.docRef)).size);
    const products = orderProducts(aggregate(period, true));
    const topRow = products.find((p) => !p.defect);
    return {
      name,
      departments: [...new Set([...mine.map((l) => l.department), ...rep.map((r) => r.department)])].sort((a, b) => a.localeCompare(b, "mn")),
      semi,
      unconfigured: name === OTHER_GROUP,
      month: out(mine.filter((l) => l.day >= monthStart && l.day <= today)),
      week: out(mine.filter((l) => l.day >= weekStart && l.day <= today)),
      period: out(period),
      periodTotal: round3(outRows(period).reduce((sum, l) => sum + l.quantity, 0)),
      unconfirmedDocs: new Set(period.filter((l) => !l.posted).map((l) => l.docRef)).size,
      products,
      top: topRow ? { name: topRow.name, qty: topRow.qty, unit: topRow.unit } : null,
      empty: period.length === 0,
      lastReport: lastDay && daysAgo !== null ? { day: lastDay, daysAgo } : null,
      recentReports,
      lagging: daysAgo !== null && daysAgo >= LAG_DAYS && recentReports >= LAG_MIN_REPORTS,
    };
  });

  // ---- сүүлийн 12 сарын гарц (сонгосон цехээр)
  const monthly = monthlyOutput(input.history ?? input.lines, scope, group, month);

  // ---- Цех × Өдөр хүснэгт (сонгосон сар бүтнээрээ; цехийн шүүлтүүрт нөлөөлөхгүй)
  const monthDays = daysOfMonth(month);
  const gridRows: GridRow[] = cards.map((c) => {
    const mine = scoped.filter((l) => groupOf(l) === c.name && l.day.startsWith(month) && isCardOutput(l, c.semi));
    const cells = monthDays.map((date) => {
      const rows = mine.filter((l) => l.day === date);
      return rows.length ? { qty: qtyOf(rows), unconfirmed: rows.some((l) => !l.posted) } : null;
    });
    return { name: c.name, semi: c.semi, unconfigured: c.unconfigured, lastReport: c.lastReport, lagging: c.lagging, recentReports: c.recentReports, idle: cells.every((x) => x === null), cells, total: qtyOf(mine) };
  });
  gridRows.sort((a, b) => Number(a.idle) - Number(b.idle)); // тогтвортой эрэмбэ: идэвхтэй цехүүд (тохиргооны дараалал), гарцгүй нь доор
  const sumRows = scoped.filter((l) => l.day.startsWith(month) && !isSemiGroup(groupOf(l)) && isOutput(l));
  const gridTotals = {
    days: monthDays.map((date) => {
      const rows = sumRows.filter((l) => l.day === date);
      return rows.length ? { qty: qtyOf(rows), unconfirmed: rows.some((l) => !l.posted) } : null;
    }),
    month: qtyOf(sumRows),
  };

  const unconfirmedDocs = new Set(lines.filter((l) => !l.posted).map((l) => l.docRef)).size;
  return {
    grid: { days: monthDays, rows: gridRows, totals: gridTotals },
    month,
    todayDate: today,
    period: range,
    group,
    groups,
    cards,
    monthly,
    today: isCurrent ? today : null,
    isCurrent,
    scopeNote: input.scopeNote ?? null,
    kpi: {
      today: qtyOf(allLines.filter((l) => l.day === today && l.stage === "finished" && variantOf(l) !== "defect")),
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
    .map((l) => ({ day: l.day, docNumber: l.docNumber, department: l.department, quantity: l.quantity, unit: l.unit, posted: l.posted, repair: splitProductName(l.product).variant === "repair", time: l.docTime ?? "" }))
    .sort((a, b) => b.day.localeCompare(a.day) || a.docNumber.localeCompare(b.docNumber, "mn"));
}

/** Сүүлийн 12 сарын (`endMonth` хүртэл) гарц: сонгосон цехийн (хагас боловсруулсан картад 1431 орно), үгүй бол бүх бэлэн бүтээгдэхүүн. Нэгж нь хамгийн их гарцтай нэгж. */
export function monthlyOutput(lines: readonly ProductionLineRow[], scope: ProductionScope, group: string | null, endMonth: string): ProductionView["monthly"] {
  const months = Array.from({ length: 12 }, (_, i) => addMonths(endMonth, i - 11));
  const semi = group !== null && isSemiGroup(group);
  const rows = lines.filter((l) => inScope(scope, l.department) && l.day.slice(0, 7) >= months[0] && l.day.slice(0, 7) <= endMonth && (group === null ? l.stage === "finished" && variantOf(l) !== "defect" : groupOf(l) === group && isCardOutput(l, semi)));
  if (!rows.length) return null;
  const unit = [...sumQuantities(rows.map((l) => ({ qty: l.quantity, unit: l.unit })))].sort((a, b) => b.qty - a.qty)[0].unit;
  const inUnit = rows.filter((l) => sumQuantities([{ qty: l.quantity, unit: l.unit }])[0]?.unit === unit);
  const by = new Map(months.map((m) => [m, { month: m, confirmed: 0, unconfirmed: 0 }]));
  for (const l of inUnit) {
    const m = by.get(l.day.slice(0, 7));
    if (m) m[l.posted ? "confirmed" : "unconfirmed"] += l.quantity;
  }
  return { unit, months: [...by.values()].map((m) => ({ ...m, confirmed: round3(m.confirmed), unconfirmed: round3(m.unconfirmed) })) };
}

/** Эрхийн хүрээн дэх, `onOrBefore`-оос ихгүй, бэлэн бүтээгдэхүүн эсвэл бутлуурын гарцтай хамгийн сүүлийн өдөр (анхдагч өдөр) */
export function latestOutputDay(lines: readonly ProductionLineRow[], scope: ProductionScope, onOrBefore: string): string | null {
  let best: string | null = null;
  for (const l of lines) {
    if ((l.stage !== "finished" && l.stage !== "crusher") || l.day > onOrBefore || !inScope(scope, l.department)) continue;
    if (best === null || l.day > best) best = l.day;
  }
  return best;
}

/** Drill-down-ы шүүлтүүр: эрхийн хүрээ, хасагдсан хэлтэс, сонгосон цех, хугацаа */
export function visibleLines(lines: readonly ProductionLineRow[], scope: ProductionScope, opts: { group?: string | null; from?: string; to?: string } = {}): ProductionLineRow[] {
  return lines.filter((l) => inScope(scope, l.department) && (!opts.group || groupOf(l) === opts.group) && (!opts.from || l.day >= opts.from) && (!opts.to || l.day <= opts.to));
}

export interface DayProduct {
  row: ProductRow;
  docs: DocLine[];
}
export interface DaySection {
  card: string;
  semi: boolean;
  unconfirmedDocs: number;
  products: DayProduct[];
}

/**
 * Нэг өдрийн задаргаа («Цех × Өдөр» хүснэгтийн нүд, өдрийн толгой): цех бүрийн бүтээгдэхүүн, тоо, брак, засвар, дор нь 1С-ийн баримт (дугаар, цаг).
 * `group` өгвөл зөвхөн тэр цех; үгүй бол бүх цех. Эрхийн хүрээ (BOSS), хасагдсан хэлтсийг `visibleLines`-аар хэрэглэнэ. Баримтын дугаар зөвхөн энд.
 */
export function dayDetail(lines: readonly ProductionLineRow[], scope: ProductionScope, opts: { day: string; group?: string | null }): DaySection[] {
  const day = visibleLines(lines, scope, { group: opts.group ?? null, from: opts.day, to: opts.day });
  const names = [...new Set(day.map(groupOf))].sort((a, b) => groupRank(a) - groupRank(b) || a.localeCompare(b, "mn"));
  return names.map((card) => {
    const mine = day.filter((l) => groupOf(l) === card);
    return {
      card,
      semi: isSemiGroup(card),
      unconfirmedDocs: new Set(mine.filter((l) => !l.posted).map((l) => l.docRef)).size,
      products: orderProducts(aggregate(mine, true)).map((row) => ({ row, docs: productDocs(mine, row.id) })),
    };
  });
}
