// 1С-ийн утгыг хүснэгтэд харуулах хэлбэрт хөрвүүлнэ (цэвэр функц: тестлэгдэнэ)
import { formatNumber } from "@/lib/utils";

const EMPTY_DATE = /^0001-01-01/;

export const KIND_LABEL: Record<string, string> = { catalog: "Лавлах", document: "Баримт", register: "Регистр", other: "Бусад", technical: "Техникийн" };
/** «technical» нь хамгийн сүүлд, анхдагчаар хаалттай бүлэг */
export const KIND_ORDER = ["catalog", "document", "register", "other", "technical"] as const;

/** "Catalog_Номенклатура" -> "Номенклатура" (бүтэн нэр tooltip-д үлдэнэ) */
export function shortObjectName(name: string): string {
  return name.replace(/^(Catalog|Document|ChartOfAccounts|ChartOfCharacteristicTypes|ExchangePlan|Constant|(?:Information|Accumulation|Accounting|Calculation)Register)_/, "");
}

export function formatCell(value: unknown, type: string): string {
  if (value === null || value === undefined || value === "") return "—";
  if (type === "ref") {
    const o = value as { Description?: unknown; Code?: unknown };
    return String(o.Description || o.Code || "—");
  }
  if (typeof value === "boolean") return value ? "✓" : "—";
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
    if (EMPTY_DATE.test(value)) return "—";
    const [d, t] = value.split("T");
    return t.startsWith("00:00:00") ? d : `${d} ${t.slice(0, 5)}`;
  }
  return String(value);
}

/** Огноо (yyyy-MM-dd), локал цагаар. today-г тестэд өгнө. */
export function lastMonthRange(today: Date = new Date()): { from: string; to: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const from = new Date(today);
  from.setMonth(from.getMonth() - 1);
  return { from: fmt(from), to: fmt(today) };
}
