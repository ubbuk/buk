import { prisma } from "@/lib/prisma";
import { isCategoryId, RULE_DIRECTIONS, RULE_FIELDS, type CashRule, type RuleDirection, type RuleField } from "./cash-categories";

/** Идэвхтэй админы дүрмүүд (priority өсөхөөр). Буруу утгатай мөр (DB-ийг гараар зассан) тайланг унагахгүй, алгасагдана. */
export async function loadCashRules(): Promise<CashRule[]> {
  const rows = await prisma.onecCashCategoryRule.findMany({ where: { isActive: true }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }] });
  const out: CashRule[] = [];
  for (const r of rows) {
    if (!isCategoryId(r.category) || !(RULE_FIELDS as readonly string[]).includes(r.field) || !(RULE_DIRECTIONS as readonly string[]).includes(r.direction)) continue;
    out.push({ direction: r.direction as RuleDirection, field: r.field as RuleField, pattern: r.pattern, category: r.category, priority: r.priority });
  }
  return out;
}
