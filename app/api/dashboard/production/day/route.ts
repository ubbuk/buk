// GET /api/dashboard/production/day?day=2026-11-24&card=<цех> — «Цех × Өдөр» хүснэгтийн нүд (card өгвөл), өдрийн толгой (card-гүй бол бүх цех) дарахад гарах задаргаа:
// цех бүрийн бүтээгдэхүүн, тоо, брак, засвар, 1С-ийн баримтын дугаар, цаг. Эрхийн хүрээ /api/dashboard/production-тэй ижил (BOSS зөвхөн өөрийн цех).
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { withTiming } from "@/lib/api-timing";
import { authOptions } from "@/lib/auth";
import { requireFinanceAccess } from "@/lib/onec/access";
import { isDate, today } from "@/lib/onec/dates";
import { groupFor } from "@/lib/onec/production-groups";
import { resolveProductionScope } from "@/lib/onec/production-scope";
import { readProductionMonth } from "@/lib/onec/production-store";
import { dayDetail } from "@/lib/onec/production-view";

export const dynamic = "force-dynamic";

export const GET = withTiming("GET /api/dashboard/production/day", async (req: Request) => {
  const denied = await requireFinanceAccess("production");
  if (denied) return denied;
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });

  const sp = new URL(req.url).searchParams;
  const day = sp.get("day");
  if (!isDate(day) || day > today()) return NextResponse.json({ error: "day нь YYYY-MM-DD, ирээдүй биш байх ёстой" }, { status: 400 });

  const rows = await readProductionMonth(day.slice(0, 7));
  const pairs = [...new Set(rows.lines.map((l) => l.department))].map((d) => ({ department: d, group: groupFor(d).name }));
  const { scope } = await resolveProductionScope(session.user.id, session.user.role, pairs);
  const sections = dayDetail(rows.lines, scope, { day, group: sp.get("card")?.slice(0, 120) || null });
  return NextResponse.json({ day, sections }, { headers: { "Cache-Control": "no-store" } });
});
