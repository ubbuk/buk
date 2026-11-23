// «Авлага» сар бүрийн эцсийн агшин зургийг нөхөж татах (12 сарын график, өмнөх сартай харьцуулалт). Нэг удаагийн ажил: өнгөрсөн сар бүрт
// ЗӨВХӨН толгой данс 1201-ийн Balance (Period = сарын эцсийн дараагийн өдрийн 00:00) нэг л хүсэлт, сар сараар ДАРААЛЛАН, хооронд нь завсарлагатай
// (1С-д ачаалал өгөхгүйн тулд). НӨАТ-ын удаан данс (1271) татагдахгүй: график, харьцуулалтад хэрэггүй. Аль хэдийн татагдсан сарыг алгасна
// (force биш үед), тиймээс дахин ажиллуулахад 1С руу хандахгүй.
import { prisma } from "@/lib/prisma";
import { currentMonth, isMonth, monthRange, monthsBetween } from "./dates";
import { MAIN_ACCOUNT } from "./receivables";
import { syncReceivablesSnapshotLocked } from "./receivables-store";

export const MAX_BACKFILL_MONTHS = 24;

export interface BackfillOptions {
  from: string;
  to: string;
  /** сар хоорондын завсарлага (секунд) */
  pauseSeconds?: number;
  /** татагдсан сарыг ч дахин татна */
  force?: boolean;
}

export interface BackfillDeps {
  has: (asOf: string) => Promise<boolean>;
  sync: (asOf: string) => Promise<{ ok: boolean } | null>;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

export interface BackfillResult {
  done: string[];
  skipped: string[];
  failed: string[];
  /** түрээс завгүй (өөр татаалт явж байна) учир алгассан */
  busy: string[];
}

const hasMainSnapshot = async (asOf: string) =>
  Number((await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM onec_receivable_balances WHERE snapshot_date = ${asOf}::date AND account_code = ${MAIN_ACCOUNT}`)[0].n) > 0;

const defaultDeps: BackfillDeps = {
  has: hasMainSnapshot,
  sync: (asOf) => syncReceivablesSnapshotLocked(asOf, [MAIN_ACCOUNT]),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  log: (line) => console.log(line),
};

/** Өнгөрсөн саруудын (from..to, одоогийн сар орохгүй) эцсийн агшин зургийг дарааллаар нөхнө. */
export async function backfillReceivables(opts: BackfillOptions, deps: BackfillDeps = defaultDeps): Promise<BackfillResult> {
  if (!isMonth(opts.from) || !isMonth(opts.to) || opts.from > opts.to) throw new Error("Жишээ: receivables-backfill 2026-01 2026-10");
  if (opts.to >= currentMonth()) throw new Error("Зөвхөн өнгөрсөн сар: одоогийн сарын агшин зургийг ердийн sync татдаг");
  const months = monthsBetween(opts.from, opts.to);
  if (months.length > MAX_BACKFILL_MONTHS) throw new Error(`Нэг удаад хамгийн ихдээ ${MAX_BACKFILL_MONTHS} сар`);

  const res: BackfillResult = { done: [], skipped: [], failed: [], busy: [] };
  let asked = false;
  for (const month of months) {
    const asOf = monthRange(month).to;
    if (!opts.force && (await deps.has(asOf))) {
      res.skipped.push(asOf);
      deps.log(`[receivables-backfill ${asOf}] аль хэдийн татагдсан: алгасав`);
      continue;
    }
    if (asked && (opts.pauseSeconds ?? 0) > 0) await deps.sleep(opts.pauseSeconds! * 1000); // 1С-д завсарлага: өмнөх хүсэлт дууссанаас хойш
    asked = true;
    const r = await deps.sync(asOf);
    if (r === null) {
      res.busy.push(asOf);
      deps.log(`[receivables-backfill ${asOf}] өөр татаалт явж байна: алгасав`);
    } else if (r.ok) {
      res.done.push(asOf);
      deps.log(`[receivables-backfill ${asOf}] татагдлаа`);
    } else {
      res.failed.push(asOf);
      deps.log(`[receivables-backfill ${asOf}] АЛДАА`);
    }
  }
  return res;
}
