// «Үйлдвэрлэл» табын харагдац: Postgres-ийн мөрүүдээс (production-store.ts) өнөөдөр / сарын гарц, өдрөөр, бүтээгдэхүүнээр, цехээр, бутлуур, өртөг.
// Цэвэр функц (DB, 1С-д хандахгүй): тестлэхэд хялбар. Клиентэд зөвхөн үр дүн (ProductionView) очно; баримтын дугаар зөвхөн drill-down (productDocs).
//
//  * «Зас» нэртэйг үндсэн бүтээгдэхүүнд нийлүүлж («үүнээс засвар»), «Брак»-ыг тусдаа мөр болгоно. Нийт гарцад брак ордоггүй; брак хувь = брак / (сайн + брак).
//  * Гол тоо нь бэлэн бүтээгдэхүүн (1441). Хагас боловсруулсан (1431) бүтээгдэхүүний хүснэгтэд «Хагас» тэмдэгтэй, нийт гарцад ордоггүй.
//    Бутлан ангилах үйлдвэрийн гарц (1401) цехийн жагсаалтад ордоггүй, тусдаа «Бутлах үйлдвэр» хэсэгт. Бэлэн гарцгүй хэлтэс (зөвхөн хагас боловсруулсан) цехийн жагсаалтад ордоггүй.
//  * Баримтын Posted=false бол «Нягтлан батлаагүй»: нийт дүнд орно, гэхдээ тусад нь тоологдож тэмдэглэгдэнэ.
//  * Өртөг: сар хаагдсан үед л (isCostClosed). Хаагдаагүй сард Сумма нь төлөвлөсөн (нэгж үнэ 1 ₮) тул харуулахгүй.
import { addDays, addMonths, monthRange } from "./dates";
import { groupFor, groupRank, isConcreteGroup, isSemiGroup, OTHER_GROUP, PRODUCTION_GROUPS } from "./production-groups";
import { daysOfMonth } from "./production-month";
import { isReclassStage, normalizeDepartment, splitProductName, type ProductionStage } from "./production-names";
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
  /** хадгалагдсан хамгийн эртний тайлангийн өдөр */
  firstDay?: string;
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
    if (isReclassStage(l.stage) || (l.stage === "crusher" && !includeCrusher)) continue; // reclass = «Дараа нь брак болсон»: гарц биш
    const stage = l.stage as ProductRow["stage"];
    const { base, variant } = splitProductName(l.product);
    const isDefect = variant === "defect";
    const id = `${keyOf(l.stage, base, l.unit)}${isDefect ? "|defect" : ""}`;
    let a = acc.get(id);
    if (!a) {
      a = { base, row: { id, name: isDefect ? `${base} · Брак` : base, unit: l.unit, stage, defect: isDefect, qty: 0, repairQty: 0, unconfirmedQty: 0, cost: null } };
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
  const scoped = input.lines.filter((l) => !isReclassStage(l.stage) && inScope(scope, l.department));
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
  return lines.filter((l) => !isReclassStage(l.stage) && inScope(scope, l.department) && (!opts.group || groupOf(l) === opts.group) && (!opts.from || l.day >= opts.from) && (!opts.to || l.day <= opts.to));
}

/** Комплектацийн шилжүүлгийн мөрүүд (эрхийн хүрээнд): гарц биш, зөвхөн бүтээгдэхүүний үлдэгдлийн тооцоонд */
export function visibleMoves(lines: readonly ProductionLineRow[], scope: ProductionScope): ProductionLineRow[] {
  return lines.filter((l) => isReclassStage(l.stage) && inScope(scope, l.department));
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

// ---------------------------------------------------------------------------------------------------------------------
// Захирлын харагдац: «Тэр өдөр юу хийсэн бэ?», «Энэ сар хэр явж байна?». Энгийн: цех бүрийн өдрийн гарц, сарын нийт, бүтээгдэхүүний нэр, тоо.
// Бетон хийцийн цехүүд (production-groups: concrete) гарцаа 3 ангиллаар: Бэлэн | Засвар | Брак.
//   Бэлэн  = 1441 гарцын нэр нь «Зас»/«Брак»-гүй мөр; Засвар = нэр нь «… Зас»; Брак = нэр нь «… Брак»/«(брак)» (тусдаа, бэлэнд ордоггүй).
//   Брак хувь = брак / (бэлэн + засвар + брак). Бусад цехэд засвар үндсэн бүтээгдэхүүнд нийлсэн хэвээр.
//   «Дараа нь брак болсон» = Комплектацийн баримтаар (stage "reclass") бэлэн/засвартай бүтээгдэхүүнийг брак болгосон, шилжүүлсэн өдрөөр. Гарцад ордоггүй (давхар тоолохгүй).
// Нягтлангийн төлөв, баримтын дугаар, цаг энд ИРЭХГҮЙ (нягтлангийн хүснэгтэд л).
// ---------------------------------------------------------------------------------------------------------------------

export interface SimpleProduct {
  name: string;
  /** бэлэн (бетон хийцийн цехэд зөвхөн бэлэн; бусад цехэд засвар нийлсэн) */
  qty: number;
  unit: string;
  /** зөвхөн бетон хийцийн цех */
  repair?: number;
  defect?: number;
}

export interface Cats {
  ready: number;
  repair: number;
  defect: number;
}

/** Нэг бүтээгдэхүүний Бэлэн/Засвар/Брак (нэг нэгжээр). Цехийн графикийг бүтээгдэхүүнээр давхарлахад */
export interface ProductCats {
  name: string;
  unit: string;
  ready: number;
  repair: number;
  defect: number;
}

export interface DirectorCard {
  name: string;
  /** бетон хийцийн цех: гарц Бэлэн | Засвар | Брак */
  concrete: boolean;
  /** сонгосон өдрийн гарц (бэлэн; цехийн нэгжээр); хоосон бол «Мэдээ ороогүй» */
  day: Quantity[];
  /** сонгосон өдрийн бүтээгдэхүүн бүр */
  products: SimpleProduct[];
  /** өдрийн гол бүтээгдэхүүн (хамгийн их бэлэн) */
  top: SimpleProduct | null;
  /** гарцтай хамгийн сүүлийн өдөр (сонгосон өдрөөс ихгүй) */
  lastDay: string | null;
  /** сонгосон өдрийн сарын нийт (бэлэн) */
  month: Quantity[];
  monthProducts: SimpleProduct[];
  /** сарын гол нэгж ба тэр нэгжээр сарын нийт бэлэн (хэвтээ багана) */
  unit: string;
  monthQty: number;
  /** сарын өдөр бүрийн бэлэн гарц (гол нэгжээр, сарын эхнээс сарын төгсгөл эсвэл өнөөдөр хүртэл) */
  monthDays: { date: string; qty: number }[];
  /** бетон хийцийн цех: өдөр, сарын Бэлэн/Засвар/Брак (гол нэгжээр); бусад цех null */
  dayCats: Cats | null;
  monthCats: Cats | null;
  /** брак хувь (өдөр, сар); брак байхгүй бол null */
  defectPct: number | null;
  monthDefectPct: number | null;
  /** дараа нь брак болсон (шилжүүлсэн өдөр, сар) */
  lateDefectDay: number;
  lateDefectMonth: number;
  /** сарын өдөр бүрийн Бэлэн/Засвар/Брак (бетон хийцийн цех) */
  monthDaysCats: (Cats & { date: string })[];
  /** сарын өдөр бүрийн бүтээгдэхүүнүүд (гол нэгжээр; зөвхөн гарцтай өдөр). Өөр бүтээгдэхүүний тоог нэмэхгүй: график бүтээгдэхүүнээр давхарлана */
  monthDaysProducts: { date: string; items: ProductCats[] }[];
  /** Бракаас / Засвараас бэлэн болгосон (Комплектаци): өдөр, сар (бүтээгдэхүүнээр), өдөр бүр. Гарцад нэмэгдэхгүй. */
  convDay: Conversions;
  convMonth: Conversions;
  convDays: { date: string; fromDefect: number; fromRepair: number }[];
}

export interface DirectorView {
  day: string;
  /** гарцтай хамгийн сүүлийн өдөр (анхдагч өдөр) */
  latestDay: string | null;
  today: string;
  month: string;
  /** гарцтай цехийн тоо */
  worked: number;
  /** гарцтай нь эхэнд (их тоогоор), мэдээгүй нь сүүлд (тохиргооны дарааллаар) */
  cards: DirectorCard[];
  /** хадгалагдсан хамгийн эртний мэдээний өдөр; сонгосон өдөр түүнээс өмнө бол мэдээ татагдаагүй */
  firstDay: string | null;
  notLoaded: boolean;
  lastSyncedAt: string | null;
  scopeNote: string | null;
  empty: boolean;
}

const qtyOfRows = (rows: readonly ProductionLineRow[]): Quantity[] => sumQuantities(rows.map((l) => ({ qty: l.quantity, unit: l.unit })));
const unitOfRow = (l: ProductionLineRow) => sumQuantities([{ qty: l.quantity, unit: l.unit }])[0]?.unit ?? "";
const isReclass = (l: { stage: string }) => isReclassStage(l.stage);
const LATE_DEFECT = "reclass";

export interface ConvProduct {
  name: string;
  unit: string;
  fromDefect: number;
  fromRepair: number;
}
/** Комплектацийн шилжүүлэг: Бракаас / Засвараас бэлэн болгосон. Гарцад ордоггүй. */
export interface Conversions {
  fromDefect: number;
  fromRepair: number;
  products: ConvProduct[];
}

function conversionsOf(rows: readonly ProductionLineRow[], inUnit: (l: ProductionLineRow) => boolean): Conversions {
  const by = new Map<string, ConvProduct>();
  let fromDefect = 0;
  let fromRepair = 0;
  for (const l of rows) {
    const isDef = l.stage === "defect_to_ready";
    if (!isDef && l.stage !== "repair_to_ready") continue;
    const k = `${splitProductName(l.product).base.toLowerCase()}|${l.unit}`;
    const p = by.get(k) ?? { name: splitProductName(l.product).base, unit: l.unit, fromDefect: 0, fromRepair: 0 };
    p[isDef ? "fromDefect" : "fromRepair"] += l.quantity;
    by.set(k, p);
    if (inUnit(l)) {
      if (isDef) fromDefect += l.quantity;
      else fromRepair += l.quantity;
    }
  }
  return {
    fromDefect: round3(fromDefect),
    fromRepair: round3(fromRepair),
    products: [...by.values()].map((p) => ({ ...p, fromDefect: round3(p.fromDefect), fromRepair: round3(p.fromRepair) })).sort((a, b) => b.fromDefect + b.fromRepair - (a.fromDefect + a.fromRepair) || a.name.localeCompare(b.name, "mn")),
  };
}

function simpleProducts(rows: readonly ProductionLineRow[]): SimpleProduct[] {
  return orderProducts(aggregate(rows, true))
    .filter((p) => !p.defect)
    .map((p) => ({ name: p.name, qty: p.qty, unit: p.unit }));
}

/** Бетон хийцийн цехийн бүтээгдэхүүн: Бэлэн, Засвар, Брак тусдаа тоо; бэлэн ихтэй нь эхэнд */
function catProducts(rows: readonly ProductionLineRow[]): SimpleProduct[] {
  const by = new Map<string, Required<SimpleProduct>>();
  for (const l of rows) {
    const { base, variant } = splitProductName(l.product);
    const k = `${base.toLowerCase()}|${l.unit}`;
    const p = by.get(k) ?? { name: base, qty: 0, unit: l.unit, repair: 0, defect: 0 };
    if (variant === "main") {
      p.name = base;
      p.qty += l.quantity;
    } else if (variant === "repair") p.repair += l.quantity;
    else p.defect += l.quantity;
    by.set(k, p);
  }
  return [...by.values()]
    .filter((p) => p.qty + p.repair + p.defect > 0)
    .sort((a, b) => b.qty - a.qty || b.repair + b.defect - (a.repair + a.defect) || a.name.localeCompare(b.name, "mn"))
    .map((p) => ({ ...p, qty: round3(p.qty), repair: round3(p.repair), defect: round3(p.defect) }));
}

/** Бүтээгдэхүүнээр (үндсэн нэр, нэгжээр) Бэлэн/Засвар/Брак. Бетон хийцийн цех биш бол засвар нь бэлэнд нийлнэ */
export function productCats(rows: readonly ProductionLineRow[], concrete: boolean): ProductCats[] {
  const by = new Map<string, ProductCats>();
  for (const l of rows) {
    const { base, variant } = splitProductName(l.product);
    const k = `${base.toLowerCase()}|${l.unit}`;
    const p = by.get(k) ?? { name: base, unit: l.unit, ready: 0, repair: 0, defect: 0 };
    if (variant === "main") p.name = base;
    if (variant === "defect") p.defect += l.quantity;
    else if (variant === "repair" && concrete) p.repair += l.quantity;
    else p.ready += l.quantity;
    by.set(k, p);
  }
  return [...by.values()]
    .filter((p) => p.ready + p.repair + p.defect > 0)
    .map((p) => ({ ...p, ready: round3(p.ready), repair: round3(p.repair), defect: round3(p.defect) }))
    .sort((a, b) => b.ready - a.ready || b.repair + b.defect - (a.repair + a.defect) || a.name.localeCompare(b.name, "mn"));
}

const catsOf = (rows: readonly ProductionLineRow[]): Cats => {
  const c = { ready: 0, repair: 0, defect: 0 };
  for (const l of rows) {
    const v = variantOf(l);
    c[v === "main" ? "ready" : v === "repair" ? "repair" : "defect"] += l.quantity;
  }
  return { ready: round3(c.ready), repair: round3(c.repair), defect: round3(c.defect) };
};
/** брак / (бэлэн + засвар + брак), хувь 1 оронтой; брак байхгүй бол null */
export const defectPercent = (c: Cats): number | null => (c.defect > 0 ? Math.round((c.defect / (c.ready + c.repair + c.defect)) * 1000) / 10 : null);

function directorCard(name: string, mine: readonly ProductionLineRow[], day: string, today: string, reportLast: string | null): DirectorCard {
  const semi = isSemiGroup(name);
  const concrete = isConcreteGroup(name);
  const real = mine.filter((l) => !isReclass(l));
  // Идэвхжилтийн мөрүүд: бетон хийцийн цехэд бүх ангилал (бэлэн, засвар, брак), бусад цехэд картын гарц
  const active = concrete ? real.filter((l) => l.stage === "finished") : real.filter((l) => isCardOutput(l, semi));
  const month = day.slice(0, 7);
  const inMonth = (l: ProductionLineRow) => l.day.startsWith(month) && l.day <= today;
  const readyOnly = (l: ProductionLineRow) => !concrete || variantOf(l) === "main";
  const dayRows = active.filter((l) => l.day === day);
  const monthRows = active.filter(inMonth);
  const primary = [...qtyOfRows(monthRows.filter(readyOnly))].sort((a, b) => b.qty - a.qty)[0] ?? [...qtyOfRows(monthRows)].sort((a, b) => b.qty - a.qty)[0];
  const unit = primary?.unit ?? "";
  const inUnit = (l: ProductionLineRow) => unitOfRow(l) === unit;
  const range = monthRange(month);
  const last = today < range.to ? today : range.to;
  const dates: string[] = [];
  for (let d = range.from; d <= last; d = addDays(d, 1)) dates.push(d);
  const monthDays = dates.map((date) => ({ date, qty: round3(monthRows.filter((l) => l.day === date && readyOnly(l) && inUnit(l)).reduce((s, l) => s + l.quantity, 0)) }));
  const monthDaysProducts = dates.map((date) => ({ date, items: productCats(monthRows.filter((l) => l.day === date && inUnit(l)), concrete) })).filter((d) => d.items.length > 0);
  const monthDaysCats = concrete ? dates.map((date) => ({ date, ...catsOf(monthRows.filter((l) => l.day === date && inUnit(l))) })) : [];

  const dayCats = concrete ? catsOf(dayRows.filter(inUnit)) : null;
  const monthCats = concrete ? catsOf(monthRows.filter(inUnit)) : null;
  const dayReady = dayRows.filter(readyOnly);
  // Бетон хийцийн цех: бэлэн гарцгүй ч засвар/брак байвал өдөр «мэдээтэй» (0 бэлэн)
  const dayQty = dayReady.length ? qtyOfRows(dayReady) : dayRows.length && unit ? [{ unit, qty: 0 }] : [];
  const products = concrete ? catProducts(dayRows) : simpleProducts(dayRows);
  const convRows = mine.filter((l) => l.stage === "defect_to_ready" || l.stage === "repair_to_ready");
  // Сард гарц байхгүй ч шилжүүлэг байж болно (нэгж хоосон): тэр үед шилжүүлгийн гол нэгжээр
  const sideUnit = unit || ([...qtyOfRows(mine.filter((l) => isReclass(l)))].sort((a, b) => b.qty - a.qty)[0]?.unit ?? "");
  const inSide = (l: ProductionLineRow) => unitOfRow(l) === sideUnit;
  const late = mine.filter((l) => l.stage === LATE_DEFECT && inSide(l));
  const convMonth = conversionsOf(convRows.filter(inMonth), inSide);
  const convDays = dates
    .map((date) => ({ date, ...(({ fromDefect, fromRepair }) => ({ fromDefect, fromRepair }))(conversionsOf(convRows.filter((l) => l.day === date), inSide)) }))
    .filter((d) => d.fromDefect > 0 || d.fromRepair > 0);
  const own = active.filter((l) => l.day <= day).reduce<string | null>((best, l) => (best === null || l.day > best ? l.day : best), null);
  return {
    name,
    concrete,
    day: dayQty,
    products,
    top: products.reduce<SimpleProduct | null>((best, p) => (best === null || p.qty > best.qty ? p : best), null),
    lastDay: own ?? (reportLast && reportLast <= day ? reportLast : null),
    month: qtyOfRows(monthRows.filter(readyOnly)),
    monthProducts: concrete ? catProducts(monthRows) : simpleProducts(monthRows),
    unit,
    monthQty: round3(monthRows.filter((l) => readyOnly(l) && inUnit(l)).reduce((s, l) => s + l.quantity, 0)),
    monthDays,
    dayCats,
    monthCats,
    defectPct: dayCats ? defectPercent(dayCats) : null,
    monthDefectPct: monthCats ? defectPercent(monthCats) : null,
    lateDefectDay: round3(late.filter((l) => l.day === day).reduce((s, l) => s + l.quantity, 0)),
    lateDefectMonth: round3(late.filter(inMonth).reduce((s, l) => s + l.quantity, 0)),
    monthDaysCats,
    monthDaysProducts,
    convDay: conversionsOf(convRows.filter((l) => l.day === day), inSide),
    convMonth,
    convDays,
  };
}

const biggest = (c: DirectorCard) => c.day.reduce((s, q) => Math.max(s, q.qty), 0);

export function buildDirectorView(input: {
  day?: string | null;
  today: string;
  lines: readonly ProductionLineRow[];
  scope?: ProductionScope;
  scopeNote?: string | null;
  lastReports?: readonly ReportInfo[];
  lastSyncedAt?: string | null;
}): DirectorView {
  const scope = input.scope ?? { departments: null };
  const scoped = input.lines.filter((l) => inScope(scope, l.department));
  const reports = (input.lastReports ?? []).filter((r) => inScope(scope, r.department));
  const latestDay = latestOutputDay(input.lines, scope, input.today);
  const day = input.day && input.day <= input.today ? input.day : (latestDay ?? input.today);

  // Бүх тохиргооны цех үргэлж харагдана (мэдээгүй нь «Мэдээ ороогүй»); BOSS зөвхөн өөрийн цех; тохиргоогүй хэлтэс «Бусад»
  const present = new Set([...scoped.filter((l) => !isReclass(l)).map(groupOf), ...reports.map(groupOf)]);
  const names = [...new Set([...(scope.departments === null ? PRODUCTION_GROUPS.map((g) => g.name) : []), ...present])].sort((a, b) => groupRank(a) - groupRank(b) || a.localeCompare(b, "mn"));
  const cards = names.map((name) =>
    directorCard(
      name,
      scoped.filter((l) => groupOf(l) === name),
      day,
      input.today,
      reports.filter((r) => groupOf(r) === name).reduce<string | null>((best, r) => (best === null || r.lastDay > best ? r.lastDay : best), null)
    )
  );
  const withData = cards.filter((c) => c.day.length > 0).sort((a, b) => biggest(b) - biggest(a));
  const idle = cards.filter((c) => c.day.length === 0);
  const firstDays = [...reports.map((r) => r.firstDay), ...scoped.filter((l) => !isReclass(l)).map((l) => l.day)].filter((d): d is string => !!d);
  const firstDay = firstDays.length ? firstDays.reduce((a, b) => (a < b ? a : b)) : null;
  return {
    day,
    latestDay,
    today: input.today,
    month: day.slice(0, 7),
    worked: withData.length,
    cards: [...withData, ...idle],
    firstDay,
    notLoaded: firstDay !== null && day < firstDay,
    lastSyncedAt: input.lastSyncedAt ?? null,
    scopeNote: input.scopeNote ?? null,
    empty: scoped.length === 0,
  };
}

export interface WorkshopView {
  day: string;
  latestDay: string | null;
  today: string;
  name: string;
  /** null = ийм цех байхгүй эсвэл эрхгүй */
  card: DirectorCard | null;
  firstDay: string | null;
  notLoaded: boolean;
  /** сүүлийн 12 сар (өнөөдрийн сараас хойш тоолно, сонгосон өдрөөс үл хамаарна): бэлэн гарц, цехийн гол нэгжээр */
  months: { month: string; qty: number }[];
  monthsUnit: string;
  /** бетон хийцийн цех: сар бүрийн Бэлэн/Засвар/Брак ба 12 сарын брак хувь */
  monthsCats: (Cats & { month: string })[] | null;
  /** сар бүрийн бүтээгдэхүүнүүд (цехийн гол нэгжээр): график бүтээгдэхүүнээр давхарлагдана, брак хувь бүтээгдэхүүн бүрээр */
  monthsProducts: { month: string; items: ProductCats[] }[];
  /** энэ сард зарцуулсан материал: хэлтсээр */
  material: { amount: number; items: { name: string; amount: number }[] } | null;
  lastSyncedAt: string | null;
  scopeNote: string | null;
}

/** Сүүлийн 12 сарын (`endMonth` хүртэл) Бэлэн/Засвар/Брак: бетон хийцийн цехийн. Нэгж нь хамгийн их гарцтай нэгж. */
export function monthlyCategories(lines: readonly ProductionLineRow[], scope: ProductionScope, group: string, endMonth: string): { unit: string; months: (Cats & { month: string })[] } | null {
  const months = Array.from({ length: 12 }, (_, i) => addMonths(endMonth, i - 11));
  const rows = lines.filter((l) => l.stage === "finished" && inScope(scope, l.department) && groupOf(l) === group && l.day.slice(0, 7) >= months[0] && l.day.slice(0, 7) <= endMonth);
  if (!rows.length) return null;
  const unit = [...qtyOfRows(rows)].sort((a, b) => b.qty - a.qty)[0].unit;
  const inUnit = rows.filter((l) => unitOfRow(l) === unit);
  return { unit, months: months.map((month) => ({ month, ...catsOf(inUnit.filter((l) => l.day.startsWith(month))) })) };
}

/** Нэг цехийн хуудас: өдөр, сар, 12 сар, материал. `lines` нь сонгосон өдөр, өнөөдрийн сарыг хамарна; `history` нь сүүлийн 12 сар; `ledger` нь сонгосон сарын. */
export function buildWorkshopView(input: {
  name: string;
  day?: string | null;
  today: string;
  lines: readonly ProductionLineRow[];
  history: readonly ProductionLineRow[];
  ledger: readonly ProductionLedgerRow[];
  scope?: ProductionScope;
  scopeNote?: string | null;
  lastReports?: readonly ReportInfo[];
  lastSyncedAt?: string | null;
}): WorkshopView {
  const scope = input.scope ?? { departments: null };
  const dv = buildDirectorView(input);
  const card = dv.cards.find((c) => c.name === input.name) ?? null;
  const end = input.today.slice(0, 7);
  const cats = card?.concrete ? monthlyCategories(input.history, scope, input.name, end) : null;
  const monthly = card && !card.concrete ? monthlyOutput(input.history, scope, input.name, end) : null;
  const base = (u: string) => sumQuantities([{ qty: 1, unit: u }])[0]?.unit;
  const unit = cats?.unit ?? monthly?.unit ?? card?.unit ?? "";
  const months = cats ? cats.months.map((m) => ({ month: m.month, qty: m.ready })) : monthly && base(monthly.unit) === base(unit) ? monthly.months.map((m) => ({ month: m.month, qty: round3(m.confirmed + m.unconfirmed) })) : [];
  const concrete = !!card?.concrete;
  const semi = isSemiGroup(input.name);
  const histMonths = Array.from({ length: 12 }, (_, i) => addMonths(end, i - 11));
  const histRows = input.history.filter((l) => !isReclass(l) && inScope(scope, l.department) && groupOf(l) === input.name && (concrete ? l.stage === "finished" : isCardOutput(l, semi)) && unitOfRow(l) === unit && l.day.slice(0, 7) >= histMonths[0] && l.day.slice(0, 7) <= end);
  const monthsProducts = card && unit ? histMonths.map((month) => ({ month, items: productCats(histRows.filter((l) => l.day.startsWith(month)), concrete) })) : [];
  const materials = card ? input.ledger.filter((r) => r.kind === "material" && inScope(scope, r.department) && groupOf(r) === input.name) : [];
  const by = new Map<string, number>();
  for (const r of materials) by.set(r.department, (by.get(r.department) ?? 0) + r.amount);
  return {
    day: dv.day,
    latestDay: dv.latestDay,
    today: dv.today,
    name: input.name,
    card,
    firstDay: dv.firstDay,
    notLoaded: dv.notLoaded,
    months,
    monthsUnit: unit,
    monthsCats: cats?.months ?? null,
    monthsProducts,
    material: materials.length ? { amount: round2(materials.reduce((s, r) => s + r.amount, 0)), items: [...by].map(([name, amount]) => ({ name, amount: round2(amount) })).sort((a, b) => b.amount - a.amount) } : null,
    lastSyncedAt: dv.lastSyncedAt,
    scopeNote: dv.scopeNote,
  };
}
