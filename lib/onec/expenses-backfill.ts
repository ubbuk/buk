// «Зардал» өнгөрсөн саруудыг нөхөж татах (12 сарын график, өмнөх сартай харьцуулалт). Нэг удаагийн ажил: сар бүрт ЗӨВХӨН ашиг алдагдлын (pl)
// татаалт, сар сараар ДАРААЛЛАН, хооронд нь завсарлагатай (1С-д ачаалал өгөхгүйн тулд). Борлуулалтын баримт (sales) татахгүй. Аль хэдийн татагдсан
// сарыг алгасна (force биш үед), тиймээс дахин ажиллуулахад 1С руу хандахгүй.
import { prisma } from "@/lib/prisma";
import { currentMonth, isMonth, monthsBetween } from "./dates";
import { syncPlMonth } from "./sync";

export const MAX_EXPENSES_BACKFILL_MONTHS = 24;

export interface ExpensesBackfillOptions {
  from: string;
  to: string;
  /** сар хоорондын завсарлага (секунд) */
  pauseSeconds?: number;
  /** татагдсан сарыг ч дахин татна */
  force?: boolean;
}

export interface ExpensesBackfillDeps {
  has: (month: string) => Promise<boolean>;
  sync: (month: string, force: boolean) => Promise<unknown>;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

export interface ExpensesBackfillResult {
  done: string[];
  skipped: string[];
  failed: string[];
}

const defaultDeps: ExpensesBackfillDeps = {
  has: async (month) => (await prisma.onecPl.count({ where: { month } })) > 0,
  sync: (month, force) => syncPlMonth(month, force),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  log: (line) => console.log(line),
};

/** Өнгөрсөн саруудын (from..to, одоогийн сар орохгүй) зардлыг дарааллаар нөхнө. */
export async function backfillExpenses(opts: ExpensesBackfillOptions, deps: ExpensesBackfillDeps = defaultDeps): Promise<ExpensesBackfillResult> {
  if (!isMonth(opts.from) || !isMonth(opts.to) || opts.from > opts.to) throw new Error("Жишээ: expenses-backfill 2026-01 2026-10");
  if (opts.to >= currentMonth()) throw new Error("Зөвхөн өнгөрсөн сар: одоогийн сарыг ердийн sync татдаг");
  const months = monthsBetween(opts.from, opts.to);
  if (months.length > MAX_EXPENSES_BACKFILL_MONTHS) throw new Error(`Нэг удаад хамгийн ихдээ ${MAX_EXPENSES_BACKFILL_MONTHS} сар`);

  const res: ExpensesBackfillResult = { done: [], skipped: [], failed: [] };
  let asked = false;
  for (const month of months) {
    if (!opts.force && (await deps.has(month))) {
      res.skipped.push(month);
      deps.log(`[expenses-backfill ${month}] аль хэдийн татагдсан: алгасав`);
      continue;
    }
    if (asked && (opts.pauseSeconds ?? 0) > 0) await deps.sleep(opts.pauseSeconds! * 1000);
    asked = true;
    try {
      await deps.sync(month, !!opts.force);
      res.done.push(month);
      deps.log(`[expenses-backfill ${month}] татагдлаа`);
    } catch {
      res.failed.push(month);
      deps.log(`[expenses-backfill ${month}] АЛДАА`);
    }
  }
  return res;
}
