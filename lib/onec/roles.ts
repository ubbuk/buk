// 1С санхүүгийн самбарыг харах дүрүүд ба табууд. Edge/клиент аюулгүй: сервер импортгүй.
//
//  * Удирдлага (FINANCE_ROLES): бүх таб.
//  * Нярав (STOREKEEPER): зөвхөн Агуулах, Зарцуулалт таб.
// Хуудас (middleware, page) болон API route бүр энэ жагсаалтаар сервер дээр шалгана (lib/onec/access.ts, lib/route-access.ts).
export const FINANCE_ROLES: readonly string[] = ["ADMIN", "DIRECTOR", "CHIEF_ACCOUNTANT", "BOSS", "ENGINEERING"];
export const STOREKEEPER_ROLE = "STOREKEEPER";

export const FINANCE_TABS = ["stock", "sales", "usage", "receivables", "expenses", "cash"] as const;
export type FinanceTab = (typeof FINANCE_TABS)[number];

/** Нярав харах таб */
export const WAREHOUSE_TABS: readonly FinanceTab[] = ["stock", "usage"];

export const TAB_LABELS: Record<FinanceTab, string> = {
  stock: "Агуулах",
  sales: "Борлуулалт",
  usage: "Зарцуулалт",
  receivables: "Авлага",
  expenses: "Зардал",
  cash: "Мөнгөн хөрөнгө",
};

export function canViewTab(role: string | undefined | null, tab: FinanceTab): boolean {
  if (!role) return false;
  if (FINANCE_ROLES.includes(role)) return true;
  return role === STOREKEEPER_ROLE && WAREHOUSE_TABS.includes(tab);
}

/** Самбарын аль нэг табыг харах эрхтэй юу (цэс, /finance) */
export const canViewFinance = (role: string | undefined | null): boolean => FINANCE_TABS.some((t) => canViewTab(role, t));

/** Тухайн таб руу орох эрхтэй дүрүүд (route-access-д) */
export const rolesForTab = (tab: FinanceTab): string[] => [...FINANCE_ROLES, ...(WAREHOUSE_TABS.includes(tab) ? [STOREKEEPER_ROLE] : [])];
