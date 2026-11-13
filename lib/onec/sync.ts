import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fetchCash, fetchPl, fetchReceivables, fetchSales, fetchStock, type FetchOpts } from "./client";
import { addMonths, currentMonth, isDate, isMonth, monthRange, monthsBetween, today } from "./dates";

export { addMonths, currentMonth, isDate, isMonth, monthRange, monthsBetween, today };

const s = (v: unknown) => (v == null ? "" : String(v).trim()); // нэрний ард илүү зай цэвэрлэнэ
const n = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
const d = (v: unknown) => new Date(`${s(v).slice(0, 10)}T00:00:00.000Z`); // @db.Date багана

const BATCH = 2000;

async function log(kind: string, period: string, rows: number, ok: boolean, message: string | null, startedAt: Date) {
  await prisma.onecSyncLog.create({ data: { kind, period, rows, ok, message, startedAt } });
}

/**
 * Нэг сар/өдрийн өгөгдлийг бүхэлд нь солино: хуучин мөрүүдийг устгаад шинээр бичнэ.
 * Нэг transaction дотор хийдэг тул алдаа гарвал хуучин өгөгдөл хэвээр үлдэнэ.
 * 1С 0 мөр буцаасан ч DB-д өгөгдөл байвал устгахгүй (force-оор албадна).
 */
async function replacePeriod<Row>(opts: {
  kind: string;
  period: string;
  fetch: () => Promise<Row[]>;
  count: () => Promise<number>;
  replace: (tx: Prisma.TransactionClient, rows: Row[]) => Promise<void>;
  force?: boolean;
}): Promise<number> {
  const startedAt = new Date();
  try {
    const rows = await opts.fetch();

    if (rows.length === 0 && !opts.force) {
      const existing = await opts.count();
      if (existing > 0) {
        const msg = `1С 0 мөр буцаасан, DB-д ${existing} мөр байгаа тул алгаслаа (--force ашиглаж болно)`;
        await log(opts.kind, opts.period, 0, false, msg, startedAt);
        console.warn(`[${opts.kind} ${opts.period}] ${msg}`);
        return 0;
      }
    }

    await prisma.$transaction((tx) => opts.replace(tx, rows));

    const secs = ((Date.now() - startedAt.getTime()) / 1000).toFixed(1);
    await log(opts.kind, opts.period, rows.length, true, `${secs}s`, startedAt);
    console.log(`[${opts.kind} ${opts.period}] ${rows.length} мөр, ${secs}s`);
    return rows.length;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await log(opts.kind, opts.period, 0, false, msg, startedAt).catch(() => {});
    console.error(`[${opts.kind} ${opts.period}] АЛДАА: ${msg}`);
    throw e;
  }
}

async function chunked<T>(rows: T[], write: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += BATCH) await write(rows.slice(i, i + BATCH));
}

export function syncSalesMonth(ym: string, force = false) {
  const { from, to } = monthRange(ym);
  const range = { gte: d(from), lte: d(to) };
  return replacePeriod({
    kind: "sales",
    period: ym,
    force,
    fetch: async () =>
      (await fetchSales(from, to)).map((r) => ({
        date: d(r.date), org: s(r.org), itemCode: s(r.item_code), item: s(r.item), unit: s(r.unit),
        qty: n(r.qty), amount: n(r.amount), vat: n(r.vat), cost: n(r.cost),
        clientCode: s(r.client_code), client: s(r.client), clientReg: s(r.client_reg),
        dept: s(r.dept), doc: s(r.doc), rowType: s(r.row_type),
      })),
    count: () => prisma.onecSales.count({ where: { date: range } }),
    replace: async (tx, rows) => {
      await tx.onecSales.deleteMany({ where: { date: range } });
      await chunked(rows, (data) => tx.onecSales.createMany({ data }));
    },
  });
}

export function syncPlMonth(ym: string, force = false) {
  const { from, to } = monthRange(ym);
  return replacePeriod({
    kind: "pl",
    period: ym,
    force,
    fetch: async () =>
      (await fetchPl(from, to)).map((r) => ({
        month: s(r.month) || ym, itemCode: s(r.item_code), item: s(r.item), account: s(r.account),
        accountGroup: s(r.group), side: s(r.side), amount: n(r.amount),
      })),
    count: () => prisma.onecPl.count({ where: { month: ym } }),
    replace: async (tx, rows) => {
      await tx.onecPl.deleteMany({ where: { month: ym } });
      await chunked(rows, (data) => tx.onecPl.createMany({ data }));
    },
  });
}

export function syncCashMonth(ym: string, force = false) {
  const { from, to } = monthRange(ym);
  const range = { gte: d(from), lte: d(to) };
  return replacePeriod({
    kind: "cash",
    period: ym,
    force,
    fetch: async () =>
      (await fetchCash(from, to)).map((r) => ({
        date: d(r.date), account: s(r.account), clientCode: s(r.client_code), client: s(r.client),
        itemCode: s(r.item_code), item: s(r.item), inflow: n(r.inflow), outflow: n(r.outflow),
        memo: s(r.memo), doc: s(r.doc),
      })),
    count: () => prisma.onecCash.count({ where: { date: range } }),
    replace: async (tx, rows) => {
      await tx.onecCash.deleteMany({ where: { date: range } });
      await chunked(rows, (data) => tx.onecCash.createMany({ data }));
    },
  });
}

/** Тухайн өдрийн агуулахын үлдэгдлийн агшин зургийг солино (өдөрт олон удаа ажиллуулж болно) */
export function syncStock(date = today(), force = false, opts?: FetchOpts) {
  return replacePeriod({
    kind: "stock",
    period: date,
    force,
    fetch: async () =>
      (await fetchStock(date, opts)).map((r) => ({
        snapshotDate: d(date), org: s(r.org), warehouseCode: s(r.warehouse_code), warehouse: s(r.warehouse),
        itemCode: s(r.item_code), item: s(r.item), unit: s(r.unit), account: s(r.account),
        qty: n(r.qty), amount: n(r.amount),
      })),
    count: () => prisma.onecStock.count({ where: { snapshotDate: d(date) } }),
    replace: async (tx, rows) => {
      await tx.onecStock.deleteMany({ where: { snapshotDate: d(date) } });
      await chunked(rows, (data) => tx.onecStock.createMany({ data }));
    },
  });
}

/** Тухайн өдрийн авлагын агшин зургийг солино */
export function syncReceivables(date = today(), force = false) {
  return replacePeriod({
    kind: "receivables",
    period: date,
    force,
    fetch: async () =>
      (await fetchReceivables(date)).map((r) => ({
        snapshotDate: d(date), type: s(r.type), clientCode: s(r.client_code), client: s(r.client),
        doc: s(r.doc), docDate: s(r.doc_date).slice(0, 10), due: s(r.due).slice(0, 10),
        amount: n(r.amount), balance: n(r.balance), overdueDays: Math.trunc(n(r.overdue_days)),
      })),
    count: () => prisma.onecReceivable.count({ where: { snapshotDate: d(date) } }),
    replace: async (tx, rows) => {
      await tx.onecReceivable.deleteMany({ where: { snapshotDate: d(date) } });
      await chunked(rows, (data) => tx.onecReceivable.createMany({ data }));
    },
  });
}

/** Нэг сарын борлуулалт + P&L (мөнгөн хөрөнгө одоо OData-аас, lib/onec/cash.ts). Нэг нь алдаа гарсан ч бусдыг үргэлжлүүлнэ. */
export async function syncMonth(ym: string, force = false): Promise<boolean> {
  // 1С-ийн ачаалал, лицензийн хэрэглээг бууруулахын тулд зэрэг биш, дараалан дуудна
  let ok = true;
  for (const job of [syncSalesMonth, syncPlMonth]) { // мөнгөн хөрөнгө одоо OData-аас (lib/onec/cash.ts): syncCashMonth ашиглагдахгүй
    try {
      await job(ym, force);
    } catch {
      ok = false;
    }
  }
  return ok;
}
