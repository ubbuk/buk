import {
  Archive,
  BarChart3,
  Activity,
  ClipboardCheck,
  FilePlus2,
  ListChecks,
  Receipt,
  Settings,
  ShieldCheck,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badgeKey?: "approvals" | "accounting";
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/requests/new", label: "Шинэ захиалга", icon: FilePlus2 },
  { href: "/requests", label: "Миний захиалгууд", icon: ListChecks },
  { href: "/approvals", label: "Батлах хүсэлтүүд", icon: ClipboardCheck, badgeKey: "approvals" },
  { href: "/warehouses", label: "Агуулахын жагсаалт", icon: Warehouse },
  { href: "/archive", label: "Захиалгын архив", icon: Archive },
  { href: "/reports", label: "Тайлан", icon: BarChart3 },
  { href: "/settings", label: "Тохиргоо", icon: Settings },
];

export const ACCOUNTING_NAV_ITEM: NavItem = {
  href: "/accounting",
  label: "Санхүүгийн бүртгэл",
  icon: Receipt,
  badgeKey: "accounting",
};
// ADMIN and DIRECTOR (server-enforced again in /api/admin/monitoring and the page itself).
export const MONITORING_NAV_ITEM: NavItem = { href: "/admin/monitoring", label: "Хяналт, мониторинг", icon: Activity };
export const ADMIN_NAV_ITEM: NavItem = { href: "/admin", label: "Хэрэглэгч, эрх", icon: ShieldCheck };

// EMPLOYEE only creates/tracks their own requests -- no approvals, archive, or
// reports to see, so their nav is trimmed to just these.
const EMPLOYEE_NAV_HREFS = new Set(["/requests/new", "/requests", "/warehouses", "/settings"]);

export function resolveNavItems(role: string | undefined): NavItem[] {
  let items: NavItem[] = role === "EMPLOYEE" ? NAV_ITEMS.filter((item) => EMPLOYEE_NAV_HREFS.has(item.href)) : [...NAV_ITEMS];
  if (role === "CHIEF_ACCOUNTANT" || role === "ADMIN") items = [...items, ACCOUNTING_NAV_ITEM];
  if (role === "ADMIN") items = [...items, ADMIN_NAV_ITEM];
  if (role === "ADMIN" || role === "DIRECTOR") items = [...items, MONITORING_NAV_ITEM];
  return items;
}

export const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Хяналтын самбар",
  "/requests": "Миний захиалгууд",
  "/requests/new": "Шинэ захиалга",
  "/approvals": "Батлах хүсэлтүүд",
  "/warehouse": "Агуулахын шалгалт",
  "/warehouses": "Агуулахын жагсаалт",
  "/accounting": "Санхүүгийн бүртгэл",
  "/archive": "Захиалгын архив",
  "/reports": "Тайлан",
  "/settings": "Тохиргоо",
  "/admin": "Хэрэглэгч, эрх",
  "/admin/monitoring": "Хяналт, мониторинг",
  "/admin/monitoring/time-machine": "Time Machine",
};
