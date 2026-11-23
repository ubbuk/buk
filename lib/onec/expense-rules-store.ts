import { prisma } from "@/lib/prisma";
import { EXPENSE_RULE_FIELDS, isExpenseCategoryId, type ExpenseRule, type ExpenseRuleField } from "./expense-categories";

/** Идэвхтэй админы дүрмүүд (priority өсөхөөр). Буруу утгатай мөр (DB-ийг гараар зассан) тайланг унагахгүй, алгасагдана. */
export async function loadExpenseRules(): Promise<ExpenseRule[]> {
  const rows = await prisma.onecExpenseCategoryRule.findMany({ where: { isActive: true }, orderBy: [{ priority: "asc" }, { createdAt: "asc" }] });
  const out: ExpenseRule[] = [];
  for (const r of rows) {
    if (!isExpenseCategoryId(r.category) || !(EXPENSE_RULE_FIELDS as readonly string[]).includes(r.field)) continue;
    out.push({ field: r.field as ExpenseRuleField, pattern: r.pattern, category: r.category, priority: r.priority });
  }
  return out;
}
