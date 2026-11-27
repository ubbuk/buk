// «Бүх гүйлгээ»-ний чиглэлийн шүүлтүүр: ?dir=in|out|transfer (Орсон / Гарсан / Шилжүүлэг). Дутуу эсвэл буруу утга = Бүгд.
import type { CashEntry } from "./cash";
import type { ReportEntry } from "./cash-report";

export type Dir = "in" | "out" | "transfer";

export function parseDir(raw: string | null | undefined): Dir | undefined {
  return raw === "in" || raw === "out" || raw === "transfer" ? raw : undefined;
}

/** Цонхны шүүлтийн `flow` (inflow|outflow|transfer) ↔ URL-ийн `dir` */
export const dirOfFlow = (flow: "" | "inflow" | "outflow" | "transfer"): Dir | undefined => (flow === "inflow" ? "in" : flow === "outflow" ? "out" : flow === "transfer" ? "transfer" : undefined);
export const flowOfDir = (dir: Dir | undefined): "" | "inflow" | "outflow" | "transfer" => (dir === "in" ? "inflow" : dir === "out" ? "outflow" : dir === "transfer" ? "transfer" : "");

/** Банкны өөр дансны хоорондын шилжүүлэг (дотоод): нэг мөр = нэг шилжүүлэг, орсон/гарсанд ОРОХГҮЙ */
export function transferReportEntries(transfers: readonly CashEntry[]): ReportEntry[] {
  return transfers.map((t) => ({ ...t, transfer: true, category: "internal" as const }));
}

/** dir-ийн дагуу мөрүүд: in/out нь шилжүүлгийг оруулахгүй, transfer нь зөвхөн шилжүүлэг */
export function matchesDir(e: Pick<ReportEntry, "type" | "transfer">, dir: Dir | undefined): boolean {
  if (!dir) return true;
  if (dir === "transfer") return e.transfer === true || e.type === "internal";
  if (e.transfer === true || e.type === "internal") return false;
  return dir === "in" ? e.type === "inflow" : e.type === "outflow";
}

/** Шүүсэн жагсаалтын нийт: мөрийн тоо, дүнгийн нийлбэр (үргэлж эерэг дүнгүүдийн нийлбэр), цэвэр (орсон − гарсан; дотоод шилжүүлэг 0) */
export function dirTotals(entries: readonly Pick<ReportEntry, "type" | "amount" | "transfer">[]): { count: number; amountTotal: number; netTotal: number } {
  let amountTotal = 0;
  let net = 0;
  for (const e of entries) {
    amountTotal += e.amount;
    // дансны хуудасны шилжүүлэг (type inflow/outflow + transfer) өмнөх шигээ тухайн дансны талаас тоологдоно; дотоод (internal) мөр 0
    if (e.type === "inflow") net += e.amount;
    else if (e.type === "outflow") net -= e.amount;
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  return { count: entries.length, amountTotal: r(amountTotal), netTotal: r(net) };
}
