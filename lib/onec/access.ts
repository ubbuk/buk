import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { canViewTab, type FinanceTab } from "./roles";

/** null буцаавал зөвшөөрөгдсөн; үгүй бол шууд буцаах хариу. Таб бүр өөрийн дүрүүдтэй: нярав зөвхөн Агуулах, Зарцуулалт. */
export async function requireFinanceAccess(tab: FinanceTab = "sales"): Promise<NextResponse | null> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });
  if (!canViewTab(session.user.role, tab)) {
    return NextResponse.json({ error: "Энэ мэдээллийг үзэх эрхгүй" }, { status: 403 });
  }
  return null;
}
