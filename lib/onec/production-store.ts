// «Үйлдвэрлэл» табын агшин зураг (onec_production_line, onec_production_ledger): 1С-ээс (OData, зөвхөн GET) sync-ээр татаж Postgres-д хадгална.
// Сар бүрийг БҮТНЭЭР нь солино (устгаад дахин бичнэ): 1С-д баримт батлагдах, устгагдах, дүн нь хаалтаар өөрчлөгдөх тул нэмэгдүүлж бичихгүй.
//   production-month (15 минут тутам, regular): одоогийн сар (өнөөдөр багтсан) + өмнөх сар НЬ ХААГДААГҮЙ байвал (хаалтын бодит өртөг орох хүртэл).
//   production-backfill (гараар): өмнөх саруудыг дараалан, завсарлагатай; татагдсан сарыг алгасна.
// 1С-д ачаалал өгөхгүйн тулд: сар бүр бие даасан (нэг нь унасан ч дараагийнх үргэлжилнэ), нийт хугацаанд дээд хязгаар.
import { prisma } from "@/lib/prisma";
import { multiYear } from "./bases";
import { addMonths, currentMonth, isMonth, monthsBetween } from "./dates";
import { fetchProductionMonth, PRODUCTION_TIMEOUT_MS, type ProductionMonthData } from "./production";
import { isCostClosed, type ProductionLedgerRow, type ProductionLineRow, type ReportInfo } from "./production-view";
import { isReclassStage, type ProductionStage } from "./production-names";
import { assignReclassDepartments } from "./production-reclass";
import type { SnapshotStep } from "./snapshots-store";

export const PRODUCTION_LOG_KIND = "production-month";
/** Нийт хугацааны дээд хязгаар (GitHub workflow-ийн timeout-аас бага) */
export const PRODUCTION_BUDGET_MS = 180_000;

export async function writeProductionMonth(data: ProductionMonthData) {
  const syncedAt = new Date();
  // «Дараа нь брак болсон» мөрийн цех: бүтээгдэхүүний нэрээр (бусад сарын бэлэн гарц + энэ сарын гарц); олдоогүй мөр хадгалагдахгүй
  let lines = data.lines;
  if (lines.some((l) => isReclassStage(l.stage))) {
    const stored = await prisma.$queryRaw<{ product: string; department: string; quantity: number }[]>`
      SELECT product, department, sum(quantity)::float8 AS quantity FROM onec_production_line WHERE stage = 'finished' AND month <> ${data.month} GROUP BY product, department`;
    lines = assignReclassDepartments(lines, [...stored, ...lines.filter((l) => l.stage === "finished")]);
  }
  await prisma.$transaction([
    prisma.onecProductionLine.deleteMany({ where: { month: data.month } }),
    prisma.onecProductionLedger.deleteMany({ where: { month: data.month } }),
    prisma.onecProductionLine.createMany({
      data: lines.map((l) => ({ month: data.month, day: l.day, docRef: l.docRef, docNumber: l.docNumber, lineNo: l.lineNo, docTime: l.time, posted: l.posted, stage: l.stage, department: l.department, productKey: l.productKey, product: l.product, unit: l.unit, quantity: l.quantity, syncedAt })),
      skipDuplicates: true,
    }),
    prisma.onecProductionLedger.createMany({
      data: data.ledger.map((r) => ({ month: data.month, kind: r.kind, stage: r.stage, department: r.department, productKey: r.productKey, product: r.product, unit: r.unit, quantity: r.quantity, amount: r.amount, syncedAt })),
    }),
  ]);
}

export interface ProductionRows {
  lines: ProductionLineRow[];
  ledger: ProductionLedgerRow[];
  syncedAt: string | null;
}

export async function readProductionMonth(month: string): Promise<ProductionRows> {
  const [lines, ledger, last] = await Promise.all([
    prisma.$queryRaw<{ day: string; doc_ref: string; doc_number: string; doc_time: string; posted: boolean; stage: string; department: string; product: string; unit: string; quantity: number }[]>`
      SELECT day, doc_ref, doc_number, doc_time, posted, stage, department, product, unit, quantity::float8 AS quantity
        FROM onec_production_line WHERE month = ${month} ORDER BY day, doc_number, line_no`,
    prisma.$queryRaw<{ kind: string; stage: string; department: string; product: string; unit: string; quantity: number; amount: number }[]>`
      SELECT kind, stage, department, product, unit, quantity::float8 AS quantity, amount::float8 AS amount
        FROM onec_production_ledger WHERE month = ${month}`,
    prisma.onecSyncLog.findFirst({ where: { kind: PRODUCTION_LOG_KIND, ok: true }, orderBy: { finishedAt: "desc" }, select: { finishedAt: true } }),
  ]);
  return {
    lines: lines.map((l) => ({ day: l.day, docRef: l.doc_ref, docNumber: l.doc_number, docTime: l.doc_time, posted: l.posted, stage: l.stage as ProductionStage, department: l.department, product: l.product, unit: l.unit, quantity: l.quantity })),
    ledger: ledger.map((r) => ({ kind: r.kind as "output" | "material", stage: r.stage, department: r.department, product: r.product, unit: r.unit, quantity: r.quantity, amount: r.amount })),
    syncedAt: last?.finishedAt.toISOString() ?? null,
  };
}

/** Хэлтэс бүрийн сүүлийн тайлан (хадгалагдсан БҮХ сараас, батлагдсан эсэхээс үл хамаарна) ба `since` өдрөөс хойших тайлангийн (баримтын) тоо. Хураангуйн «Сүүлийн тайлан», «Тайлан хоцорч байна?»-д. */
export async function readLastReports(since: string): Promise<ReportInfo[]> {
  const rows = await prisma.$queryRaw<{ department: string; last_day: string; first_day: string; recent: number }[]>`
    SELECT department, max(day) AS last_day, min(day) AS first_day, (count(DISTINCT doc_ref) FILTER (WHERE day >= ${since}))::int AS recent FROM onec_production_line WHERE stage NOT IN ('reclass', 'defect_to_ready', 'repair_to_ready', 'swap_in', 'swap_out') GROUP BY department`;
  return rows.map((r) => ({ department: r.department, lastDay: r.last_day, firstDay: r.first_day, recent: r.recent }));
}

/** `fromMonth`..`toMonth` (хоёулаа орно) сарын мөрүүд, бичилтгүй: 12 сарын график */
export async function readProductionLines(fromMonth: string, toMonth: string): Promise<ProductionLineRow[]> {
  const rows = await prisma.$queryRaw<{ day: string; doc_ref: string; doc_number: string; doc_time: string; posted: boolean; stage: string; department: string; product: string; unit: string; quantity: number }[]>`
    SELECT day, doc_ref, doc_number, doc_time, posted, stage, department, product, unit, quantity::float8 AS quantity
      FROM onec_production_line WHERE month >= ${fromMonth} AND month <= ${toMonth} ORDER BY day, doc_number, line_no`;
  return rows.map((l) => ({ day: l.day, docRef: l.doc_ref, docNumber: l.doc_number, docTime: l.doc_time, posted: l.posted, stage: l.stage as ProductionStage, department: l.department, product: l.product, unit: l.unit, quantity: l.quantity }));
}

/** Хэд хэдэн сарын мөрүүд (хугацаа сарын хилийг давсан үед): мөр, бичилт нийлнэ; бичилт нь сар бүрийн тусдаа (ledgerByMonth) */
export async function readProductionMonths(months: readonly string[]): Promise<{ lines: ProductionLineRow[]; ledgerByMonth: Record<string, ProductionLedgerRow[]>; syncedAt: string | null }> {
  const parts = await Promise.all(months.map((m) => readProductionMonth(m)));
  return {
    lines: parts.flatMap((p) => p.lines),
    ledgerByMonth: Object.fromEntries(months.map((m, i) => [m, parts[i].ledger])),
    syncedAt: parts.map((p) => p.syncedAt).filter((s): s is string => !!s).sort().at(-1) ?? null,
  };
}

/** Сар Postgres-д (бичилт, баримт аль нэгээр) бүртгэгдсэн эсэх */
async function storedMonths(months: readonly string[]): Promise<Set<string>> {
  if (!months.length) return new Set();
  const rows = await prisma.$queryRaw<{ month: string }[]>`
    SELECT month FROM onec_production_line WHERE month = ANY(${[...months]}::text[])
    UNION SELECT month FROM onec_production_ledger WHERE month = ANY(${[...months]}::text[])`;
  return new Set(rows.map((r) => r.month));
}

export type FetchProductionMonth = (month: string, opts: { timeoutMs: number }) => Promise<ProductionMonthData>;

async function syncOne(month: string, fetchMonth: FetchProductionMonth, timeoutMs: number): Promise<SnapshotStep> {
  const startedAt = new Date();
  try {
    const data = await fetchMonth(month, { timeoutMs });
    await writeProductionMonth(data);
    const message = `${((Date.now() - startedAt.getTime()) / 1000).toFixed(1)}s (${data.lines.length} мөр, ${data.ledger.length} бичилт)`;
    await prisma.onecSyncLog.create({ data: { kind: PRODUCTION_LOG_KIND, period: month, rows: data.lines.length, ok: true, message, startedAt } }).catch(() => {});
    return { kind: PRODUCTION_LOG_KIND, period: month, ok: true, rows: data.lines.length, message };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await prisma.onecSyncLog.create({ data: { kind: PRODUCTION_LOG_KIND, period: month, rows: 0, ok: false, message, startedAt } }).catch(() => {});
    return { kind: PRODUCTION_LOG_KIND, period: month, ok: false, rows: 0, message };
  }
}

/** Өмнөх сарын өртөг хаагдсан эсэх (Postgres-ийн бичилтээр): хаагдтал өмнөх сарыг мөн дахин татна */
export async function previousMonthNeedsSync(now = currentMonth()): Promise<boolean> {
  const prev = addMonths(now, -1);
  if (prev.slice(0, 4) !== now.slice(0, 4) && !multiYear()) return false; // өмнөх оны бааз холбогдоогүй (ONEC_BASES байхгүй)
  const rows = await prisma.$queryRaw<{ kind: "output" | "material"; quantity: number; amount: number }[]>`
    SELECT kind, quantity::float8 AS quantity, amount::float8 AS amount FROM onec_production_ledger WHERE month = ${prev}`;
  if (!rows.length) return !(await storedMonths([prev])).has(prev); // бичилт огт байхгүй сар: нэг л удаа татна (дараа нь баримт бүртгэгдсэн)
  return !isCostClosed(prev, now, rows);
}

/** Алдаа шидэхгүй: сар бүрийн үр дүнг буцаана. Одоогийн сар + (хаагдаагүй бол) өмнөх сар. */
export async function syncProduction(fetchMonth: FetchProductionMonth = fetchProductionMonth, now = currentMonth(), opts: { budgetMs?: number } = {}): Promise<SnapshotStep[]> {
  const begun = Date.now();
  const budgetMs = opts.budgetMs ?? PRODUCTION_BUDGET_MS;
  const months = [now];
  if (await previousMonthNeedsSync(now).catch(() => false)) months.push(addMonths(now, -1));
  const out: SnapshotStep[] = [];
  for (const month of months) {
    const remaining = budgetMs - (Date.now() - begun);
    if (remaining < 10_000) {
      out.push({ kind: PRODUCTION_LOG_KIND, period: "stopped", ok: true, rows: 0, message: `Хугацааны хязгаарт (${Math.round(budgetMs / 1000)}s) хүрсэн, дараагийн удаа үргэлжилнэ` });
      break;
    }
    out.push(await syncOne(month, fetchMonth, Math.min(PRODUCTION_TIMEOUT_MS, remaining)));
  }
  return out;
}

/** Нэг удаагийн нөхөлт: from..to саруудыг дараалан, `pauseSeconds` завсарлагатай. Татагдсан сарыг алгасна (force бол дахин). */
export async function backfillProduction(opts: { from: string; to: string; pauseSeconds?: number; force?: boolean }, fetchMonth: FetchProductionMonth = fetchProductionMonth, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))) {
  if (!isMonth(opts.from) || !isMonth(opts.to) || opts.from > opts.to) throw new Error("Жишээ: production-backfill 2026-01 2026-10");
  const months = monthsBetween(opts.from, opts.to);
  if (months.length > 24) throw new Error("Нэг удаад 24-өөс илүүгүй сар");
  const have = opts.force ? new Set<string>() : await storedMonths(months);
  const result = { done: [] as string[], skipped: [] as string[], failed: [] as string[] };
  let first = true;
  for (const month of months) {
    if (have.has(month)) {
      result.skipped.push(month);
      continue;
    }
    if (!first && (opts.pauseSeconds ?? 15) > 0) await sleep((opts.pauseSeconds ?? 15) * 1000);
    first = false;
    const step = await syncOne(month, fetchMonth, PRODUCTION_TIMEOUT_MS);
    (step.ok ? result.done : result.failed).push(month);
  }
  return result;
}
