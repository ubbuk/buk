// Зардлыг ердийн ангилалд хуваах (дансны код, 7010 гэх мэт зардлын кодгүйгээр): «Цахилгаан, дулаан, ус, түлш», «Түрээс», «Тээвэр, томилолт» ...
// Удирдлагад нягтлангийн хэл (данс, зардлын код) харуулахгүй. Ангилал нь 1С-ийн ашиг, алдагдлын (onec_pl) мөрийн данс ба зардлын НЭРээс гарна.
//
// Дарааллаар үнэлнэ, эхэлж таарсан нь ялна:
//   1. АДМИНЫ дүрмүүд (onec_expense_category_rule, priority өсөхөөр): код өөрчлөхгүйгээр засна.
//   2. Доорх анхдагч дүрмүүд (бодит зардлын нэрээс гаргасан).
//   3. Таарахгүй бол «Бусад».
export const EXPENSE_CATEGORY_IDS = ["payroll", "utilities", "fuel", "repair", "rent", "transport", "insurance", "taxes", "depreciation", "bank", "other"] as const;
export type ExpenseCategoryId = (typeof EXPENSE_CATEGORY_IDS)[number];

export const EXPENSE_CATEGORY_LABEL: Record<ExpenseCategoryId, string> = {
  payroll: "Цалин ба НДШ",
  utilities: "Цахилгаан, дулаан, ус",
  fuel: "Түлш",
  repair: "Засвар үйлчилгээ",
  rent: "Түрээс",
  transport: "Тээвэр",
  insurance: "Даатгал",
  taxes: "Татвар, хураамж",
  depreciation: "Элэгдэл",
  bank: "Банк, санхүүгийн зардал",
  other: "Бусад",
};

export const isExpenseCategoryId = (v: unknown): v is ExpenseCategoryId => typeof v === "string" && (EXPENSE_CATEGORY_IDS as readonly string[]).includes(v);

export const EXPENSE_RULE_FIELDS = ["ACCOUNT", "ITEM"] as const;
export type ExpenseRuleField = (typeof EXPENSE_RULE_FIELDS)[number];
export const EXPENSE_RULE_FIELD_LABEL: Record<ExpenseRuleField, string> = {
  ACCOUNT: "Дансны код (угтвар)",
  ITEM: "Зардлын нэр (агуулсан үг)",
};

export interface ExpenseRule {
  field: ExpenseRuleField;
  pattern: string;
  category: ExpenseCategoryId;
  priority?: number;
}

/** Ангилах мөрийн талбарууд */
export interface ExpenseClassifiable {
  /** «7000.00» */
  account: string;
  /** зардлын нэр (кодтой байж болно: «7010 Хөдөлмөр хамгаалын зардал») */
  item: string;
}

const r = (field: ExpenseRuleField, pattern: string, category: ExpenseCategoryId): ExpenseRule => ({ field, pattern, category });

// Борлуулсан бүтээгдэхүүний өртөг (61xx) нь ангилалд ОРОХГҮЙ: тусдаа мөр (Борлуулалт таб дээр дэлгэрэнгүй). Энд зөвхөн үйл ажиллагааны зардал.
export const COGS_ACCOUNT_PREFIX = "61";
export const isCogsAccount = (account: string) => account.startsWith(COGS_ACCOUNT_PREFIX);

// Дараалал чухал: эхэлж таарсан нь ялна.
export const DEFAULT_EXPENSE_RULES: readonly ExpenseRule[] = [
  r("ITEM", "элэгдл", "depreciation"),
  r("ITEM", "хорогдол", "depreciation"),
  r("ITEM", "банк", "bank"),
  r("ITEM", "хүү", "bank"),
  r("ITEM", "валютын", "bank"),
  r("ITEM", "ханшийн", "bank"),
  r("ITEM", "санхүү", "bank"),
  r("ITEM", "цалин", "payroll"),
  r("ITEM", "ндш", "payroll"),
  r("ITEM", "хчта", "payroll"),
  r("ITEM", "тэтгэмж", "payroll"),
  r("ITEM", "урамшуулал", "payroll"),
  r("ITEM", "нийгмийн", "payroll"),
  r("ITEM", "даатгал", "insurance"),
  r("ITEM", "цахилгаан", "utilities"),
  r("ITEM", "дулаан", "utilities"),
  r("ITEM", "уур,", "utilities"),
  r("ITEM", "усны", "utilities"),
  r("ITEM", "ус хангамж", "utilities"),
  r("ITEM", "ус,", "utilities"),
  r("ITEM", "шатахуун", "fuel"),
  r("ITEM", "штм", "fuel"),
  r("ITEM", "түлш", "fuel"),
  r("ITEM", "нүүрс", "fuel"),
  r("ITEM", "түрээс", "rent"),
  r("ITEM", "тээв", "transport"),
  r("ITEM", "томилолт", "transport"),
  r("ITEM", "засвар", "repair"),
  r("ITEM", "сэлбэг", "repair"),
  r("ITEM", "үйлчилгээ", "repair"),
  r("ITEM", "цэвэрлэгээ", "repair"),
  r("ITEM", "харуул", "repair"),
  r("ITEM", "татвар", "taxes"),
  r("ITEM", "хураамж", "taxes"),
  r("ACCOUNT", "91", "taxes"),
];

const lower = (s: string) => s.normalize("NFKC").toLocaleLowerCase("mn");

function matches(rule: ExpenseRule, e: ExpenseClassifiable): boolean {
  const pattern = rule.pattern.trim();
  if (!pattern) return false;
  return rule.field === "ACCOUNT" ? e.account.startsWith(pattern) : lower(e.item).includes(lower(pattern));
}

export function categorizeExpense(e: ExpenseClassifiable, adminRules: readonly ExpenseRule[] = []): ExpenseCategoryId {
  const ordered = [...adminRules].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  for (const rule of ordered) if (matches(rule, e)) return rule.category;
  for (const rule of DEFAULT_EXPENSE_RULES) if (matches(rule, e)) return rule.category;
  return "other";
}

/** «7010 Хөдөлмөр хамгаалын зардал» → «Хөдөлмөр хамгаалын зардал»: зардлын кодыг нүүрэн дээр харуулахгүй. */
export const cleanExpenseName = (item: string): string => item.replace(/^\s*\d{3,5}[.\s]+/, "").trim() || "Нэргүй зардал";
