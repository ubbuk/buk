// Банкны гүйлгээг ердийн ангилалд хуваах. Удирдлагад нягтлангийн хэл (данс, Дт/Кт) харуулахгүй: гүйлгээ бүр «Борлуулалтын орлого»,
// «Нийлүүлэгчид», «Цалин» гэх мэт ангилалд орно. Ангилал нь харьцсан данс (1С-ийн бичилтийн нөгөө тал) ба төлбөрийн зориулалтаас гарна.
//
// Дарааллаар үнэлнэ, эхэлж таарсан нь ялна:
//   1. АДМИНЫ дүрмүүд (onec_cash_category_rule, priority өсөхөөр): ангилал, хуучин алдааг код өөрчлөхгүйгээр засна.
//   2. Доорх анхдагч дүрмүүд (кодонд; бодит дансны бичилтээс гаргасан).
//   3. Таарахгүй бол «Бусад».
// Дотоод шилжүүлэг (мөнгөний данс хоорондын) дүрмээр биш бичилтийн хэлбэрээр тодорхойлогдоно: орлого, зарлагад огт тооцогдохгүй.
export const CATEGORY_IDS = ["sales", "loan", "payroll", "tax", "suppliers", "utilities", "bankfee", "internal", "other"] as const;
export type CategoryId = (typeof CATEGORY_IDS)[number];

export const CATEGORY_LABEL: Record<CategoryId, string> = {
  sales: "Борлуулалтын орлого",
  loan: "Зээл",
  payroll: "Цалин",
  tax: "Татвар, НДШ",
  suppliers: "Нийлүүлэгчид",
  utilities: "Цахилгаан, ус, түлш",
  bankfee: "Банкны шимтгэл",
  internal: "Дотоод шилжүүлэг",
  other: "Бусад",
};

export const isCategoryId = (v: unknown): v is CategoryId => typeof v === "string" && (CATEGORY_IDS as readonly string[]).includes(v);

export const RULE_FIELDS = ["ACCOUNT", "ACCOUNT_NAME", "PARTY", "MEMO", "ARTICLE"] as const;
export type RuleField = (typeof RULE_FIELDS)[number];
export const RULE_DIRECTIONS = ["IN", "OUT", "ANY"] as const;
export type RuleDirection = (typeof RULE_DIRECTIONS)[number];

export const RULE_FIELD_LABEL: Record<RuleField, string> = {
  ACCOUNT: "Харьцсан дансны код (угтвар)",
  ACCOUNT_NAME: "Харьцсан дансны нэр (агуулсан үг)",
  PARTY: "Харилцагчийн нэр (агуулсан үг)",
  MEMO: "Гүйлгээний утга (агуулсан үг)",
  ARTICLE: "Мөнгөн гүйлгээний зүйл (агуулсан үг)",
};
export const RULE_DIRECTION_LABEL: Record<RuleDirection, string> = { IN: "Орлого", OUT: "Зарлага", ANY: "Аль ч" };

export interface CashRule {
  direction: RuleDirection;
  field: RuleField;
  pattern: string;
  category: CategoryId;
  priority?: number;
}

/** Ангилах гүйлгээний талбарууд (CashEntry-ийн дэд олонлог) */
export interface Classifiable {
  type: "inflow" | "outflow" | "internal";
  counterAccount: string;
  counterAccountName: string;
  counterpart: string;
  memo: string;
  article: string;
}

const r = (direction: RuleDirection, field: RuleField, pattern: string, category: CategoryId): CashRule => ({ direction, field, pattern, category });

// Дараалал чухал. Бодит бичилтээс (2026-08..11): харьцсан данс бүрийн хэмжээгээр бүх мөнгөний ~99% энд хамрагдсан.
export const DEFAULT_RULES: readonly CashRule[] = [
  // цалин ба түүнтэй холбоотой тооцоо (цалингийн дансны ангилал: lib/onec/payroll-guard.ts-тэй ижил)
  r("ANY", "ACCOUNT", "3342", "payroll"), // Цалингийн өглөг
  r("ANY", "ACCOUNT", "3349", "payroll"), // Ажиллагсдад өгөх бусад өглөг
  r("ANY", "ACCOUNT", "1243", "payroll"),
  r("ANY", "ACCOUNT", "1249", "payroll"), // Ажиллагсдын бусад тооцоо
  r("ANY", "ACCOUNT", "1295", "payroll"), // Нийгмийн даатгалаас авах тэтгэмж
  // татвар, НДШ
  r("ANY", "ACCOUNT", "3450", "tax"), // НДШ
  r("ANY", "ACCOUNT", "346", "tax"), // ХХОАТ, НӨАТ, ААНОАТ, газрын төлбөр, тусгай хувь хэмжээгээр тооцсон ОАТ ...
  r("ANY", "ACCOUNT", "91", "tax"), // Орлогын албан татвар
  // зээл
  r("ANY", "ACCOUNT_NAME", "зээл", "loan"),
  r("ANY", "MEMO", "зээл", "loan"),
  // цахилгаан, ус, түлш: нийлүүлэгчийн данс (3101) дотор орох тул нийлүүлэгчээс ӨМНӨ
  r("OUT", "PARTY", "цахилгаан", "utilities"),
  r("OUT", "PARTY", "дулаан", "utilities"),
  r("OUT", "PARTY", "ус суваг", "utilities"),
  r("OUT", "PARTY", "усны", "utilities"),
  r("OUT", "PARTY", "шатахуун", "utilities"),
  r("OUT", "PARTY", "түлш", "utilities"),
  r("OUT", "PARTY", "нүүрс", "utilities"),
  r("OUT", "MEMO", "цахилгаан", "utilities"),
  r("OUT", "MEMO", "дулааны", "utilities"),
  r("OUT", "MEMO", "усны төлбөр", "utilities"),
  r("OUT", "MEMO", "шатахуун", "utilities"),
  r("OUT", "MEMO", "түлш", "utilities"),
  // банкны шимтгэл
  r("OUT", "MEMO", "шимтгэл", "bankfee"),
  r("OUT", "MEMO", "хураамж", "bankfee"),
  r("OUT", "MEMO", "үйлчилгээний хөлс", "bankfee"),
  r("OUT", "ARTICLE", "шимтгэл", "bankfee"),
  r("OUT", "PARTY", "банк", "bankfee"), // зарлага, харилцагч нь банк (3101-д биш, зардлын дансанд)
  // нийлүүлэгчид: өглөг ба урьдчилж төлсөн тооцоо (буцаалт ч мөн)
  r("ANY", "ACCOUNT", "3101", "suppliers"),
  r("ANY", "ACCOUNT", "1501", "suppliers"),
  r("ANY", "ACCOUNT", "3100", "suppliers"),
  // орлого: худалдан авагчаас ирсэн (урьдчилгаа ба авлага)
  r("IN", "ACCOUNT", "3201", "sales"),
  r("IN", "ACCOUNT", "12", "sales"),
];

const lower = (s: string) => s.toLocaleLowerCase("mn").normalize("NFKC");

function matches(rule: CashRule, e: Classifiable): boolean {
  const flow = e.type === "inflow" ? "IN" : "OUT";
  if (rule.direction !== "ANY" && rule.direction !== flow) return false;
  const needle = lower(rule.pattern.trim());
  if (!needle) return false;
  switch (rule.field) {
    case "ACCOUNT":
      return e.counterAccount.startsWith(rule.pattern.trim());
    case "ACCOUNT_NAME":
      return lower(e.counterAccountName).includes(needle);
    case "PARTY":
      return lower(e.counterpart).includes(needle);
    case "MEMO":
      return lower(e.memo).includes(needle);
    case "ARTICLE":
      return lower(e.article).includes(needle);
  }
}

/** Админы дүрмийг priority-оор эрэмбэлсний дараа анхдагчийг үнэлнэ. Дотоод шилжүүлэг үргэлж `internal`. */
export function categorize(e: Classifiable, adminRules: readonly CashRule[] = []): CategoryId {
  if (e.type === "internal") return "internal";
  const ordered = [...adminRules].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  for (const rule of ordered) if (matches(rule, e)) return rule.category;
  for (const rule of DEFAULT_RULES) if (matches(rule, e)) return rule.category;
  return "other";
}
