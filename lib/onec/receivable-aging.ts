// Авлагын НАС (өр үүссэнээс хойш өнгөрсөн хоног): 0–30, 31–60, 61–90, 90+. 1С-ийн авлагын үлдэгдэлд төлбөрийн хугацаа (due date) хадгалагддаггүй тул
// «хугацаа хэтэрсэн» гэж яг хэлэх боломжгүй: харин өр хэр хуучирсныг FIFO-оор тооцно. Харилцагчийн төлбөр хамгийн хуучин борлуулалтыг ЭХЛЭЭД
// хаадаг гэж үзвэл үлдсэн өр нь ХАМГИЙН СҮҮЛИЙН борлуулалтуудаас бүрдэнэ: үлдэгдлийг сүүлийн борлуулалтаас эхлэн хуучин рүү нь хуваарилж, борлуулалт
// бүрийн огнооноос нас гарна. Цэвэр функц (Postgres-ийн борлуулалтын баримт ба агшин зургийн үлдэгдэлтэй; 1С руу хандахгүй).
//
// Хязгаар (хуудсанд бас тайлбарлана): борлуулалтын түүх татагдсан хугацаанаас өмнөх үлдэгдэл «90+»-д (түүх 90-ээс дээш хоногийг хамарсан бол),
// үгүй бол «Тодорхойгүй»-д орно. Харилцагчийг нэрээр тулгана: борлуулалтын баримт олдоогүй (өөр төрлийн авлага, нэр зөрсөн) харилцагчийн өр бүхэлдээ
// «Тодорхойгүй»: насыг таамаглахгүй.
export const AGING_BUCKETS = ["b0_30", "b31_60", "b61_90", "b90"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];
export const AGING_LABEL: Record<AgingBucket | "unknown", string> = {
  b0_30: "0–30 хоног",
  b31_60: "31–60 хоног",
  b61_90: "61–90 хоног",
  b90: "90+ хоног",
  unknown: "Нас тодорхойгүй",
};

export interface Invoice {
  /** YYYY-MM-DD */
  date: string;
  /** НӨАТ-тай нийт дүн */
  total: number;
}

export interface CustomerAging {
  b0_30: number;
  b31_60: number;
  b61_90: number;
  b90: number;
  /** түүхээр тайлбарлагдаагүй хэсэг */
  unknown: number;
  /** хамгийн хуучин төлөгдөөгүй борлуулалтын нас (хоног); мэдэгдэхгүй бол null */
  oldestDays: number | null;
}

const DAY = 86_400_000;
const round2 = (v: number) => Math.round(v * 100) / 100;
export const daysBetween = (from: string, to: string) => Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

export const bucketOf = (days: number): AgingBucket => (days <= 30 ? "b0_30" : days <= 60 ? "b31_60" : days <= 90 ? "b61_90" : "b90");

/**
 * Нэг харилцагчийн өр (balance > 0) -ийг борлуулалтын баримтуудад сүүлийнхээс нь эхэлж хуваарилна.
 * `historyStart`: борлуулалтын түүх хаанаас эхэлдэг (хамгийн эхний татагдсан өдөр). Түүхээс давсан үлдэгдэл: asOf - historyStart ≥ 91 бол «90+»,
 * үгүй бол «Тодорхойгүй».
 */
export function ageCustomer(balance: number, invoices: readonly Invoice[], asOf: string, historyStart: string | null): CustomerAging {
  const out: CustomerAging = { b0_30: 0, b31_60: 0, b61_90: 0, b90: 0, unknown: 0, oldestDays: null };
  if (balance <= 0) return out;
  // Борлуулалтын баримт огт олдоогүй (өөр төрлийн авлага: банк, хувь хүн, нэр зөрсөн): насыг таамаглахгүй
  if (invoices.length === 0) {
    out.unknown = round2(balance);
    return out;
  }
  let rest = balance;
  const dated = invoices.filter((i) => i.total > 0 && i.date <= asOf).sort((a, b) => b.date.localeCompare(a.date));
  for (const inv of dated) {
    if (rest <= 0.005) break;
    const take = Math.min(rest, inv.total);
    const days = Math.max(0, daysBetween(inv.date, asOf));
    out[bucketOf(days)] += take;
    out.oldestDays = days;
    rest -= take;
  }
  if (rest > 0.005) {
    const covered = historyStart !== null && daysBetween(historyStart, asOf) >= 91;
    out[covered ? "b90" : "unknown"] += rest;
    if (covered) out.oldestDays = Math.max(out.oldestDays ?? 0, daysBetween(historyStart, asOf));
  }
  for (const k of [...AGING_BUCKETS, "unknown"] as const) out[k] = round2(out[k]);
  return out;
}

export interface AgingTotals {
  buckets: { key: AgingBucket | "unknown"; label: string; amount: number; customers: number }[];
  /** 30-аас дээш хоногийн өр (31–60, 61–90, 90+) */
  over30: number;
}

export function totalAging(per: readonly CustomerAging[]): AgingTotals {
  const keys = [...AGING_BUCKETS, "unknown"] as const;
  const buckets = keys.map((key) => ({ key, label: AGING_LABEL[key], amount: round2(per.reduce((s, a) => s + a[key], 0)), customers: per.filter((a) => a[key] > 0.005).length }));
  const over30 = round2(per.reduce((s, a) => s + a.b31_60 + a.b61_90 + a.b90, 0));
  return { buckets, over30 };
}

/** Нэрийн тулгалтын түлхүүр: том жижиг үсэг, зай, ХХК/ХК зэрэг хэлбэрийн үгийг үл харгалзана */
const LEGAL_FORMS = new Set(["ххк", "хк", "ооо", "llc", "co", "ltd", "inc"]);
export function nameKey(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/["'«»“”.,()\-_/\\]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !LEGAL_FORMS.has(w)) // \b нь кирилл үсэгт ажиллахгүй тул үгээр нь
    .join(" ");
}
