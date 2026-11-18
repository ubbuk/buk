import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { loadViewer } from "@/lib/onec-odata/viewer";
import { canViewTab, PAYROLL_ROLES, type FinanceTab } from "./roles";

/** null буцаавал зөвшөөрөгдсөн; үгүй бол шууд буцаах хариу. Таб бүр өөрийн дүрүүдтэй: нярав зөвхөн Агуулах, Зарцуулалт. */
export async function requireFinanceAccess(tab: FinanceTab = "sales"): Promise<NextResponse | null> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });
  if (!canViewTab(session.user.role, tab)) {
    return NextResponse.json({ error: "Энэ мэдээллийг үзэх эрхгүй" }, { status: 403 });
  }
  return null;
}

/** Нэвтэрсэн хэрэглэгч цалингийн мэдээлэл (хүний нэр, утга) харах эрхтэй юу: хүсэлт бүрд DB-ээс уншина (session-д cache-лэхгүй). Эрхгүй бол цалинг нэгтгэж харуулна (lib/onec/payroll-guard.ts). */
export async function viewerCanSeePayroll(): Promise<boolean> {
  const session = await getServerSession(authOptions);
  if (!session) return false;
  return (await loadViewer(session.user.id))?.canViewPayroll === true;
}

export type PayrollAuth = { ok: true; userId: string; role: string } | { ok: false; res: NextResponse };

/** «Цалин» табын API: дүр (PAYROLL_ROLES) БА canViewPayroll хоёулаа, хүсэлт бүрд DB-ээс. Эрхгүй бол 403 (хэзээ ч өгөгдөл буцаахгүй). */
export async function requirePayrollAccess(): Promise<PayrollAuth> {
  const session = await getServerSession(authOptions);
  if (!session) return { ok: false, res: NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 }) };
  const viewer = await loadViewer(session.user.id);
  if (!viewer) return { ok: false, res: NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 }) };
  if (!PAYROLL_ROLES.includes(viewer.role) || viewer.canViewPayroll !== true) {
    return { ok: false, res: NextResponse.json({ error: "Энэ мэдээллийг үзэх эрхгүй" }, { status: 403 }) };
  }
  return { ok: true, userId: session.user.id, role: viewer.role };
}
