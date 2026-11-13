// Зардлын бүлэг: 1С-ийн /hs/dash/pl дахь `group` талбар (onec_pl.account_group). Техникийн код дэлгэцэд гарахгүй.
// Одоогоор 1С зөвхөн: cogs (борлуулсан бүтээгдэхүүний өртөг), admin (удирдлагын зардал), other гэх мэт бүдүүн бүлэг өгдөг.
// Цалин, түрээс, тээвэр зэрэг нарийн бүлэг хэрэгтэй бол дансны кодоор ангилах дүрэм нэмнэ.
const LABELS: Record<string, string> = {
  cogs: "Борлуулсан бүтээгдэхүүний өртөг",
  admin: "Удирдлагын зардал",
  selling: "Борлуулалтын зардал",
  finance: "Санхүүгийн зардал",
  tax: "Татвар",
  other: "Бусад",
};

export const expenseGroupLabel = (raw: string | null | undefined): string => {
  const key = (raw ?? "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(LABELS, key) ? LABELS[key] : "Бусад"; // "constructor" зэрэг prototype түлхүүр биш
};

/** Өмнөх сартай харьцуулсан өөрчлөлт, %: өмнөх нь 0 бол тодорхойгүй (null) */
export function changePct(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}
