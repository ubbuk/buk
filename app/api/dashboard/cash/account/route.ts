// GET /api/dashboard/cash/account?id=<дансны ID>&day=2026-11-25 | &month=2026-11 — нэг дансны сонгосон хугацааны 4 тоо: эхний үлдэгдэл, орсон, гарсан, эцсийн үлдэгдэл.
// Орсон/гарсан нь дансны хоорондын шилжүүлгийг багтаана (эхний + орсон − гарсан = эцсийн); шилжүүлэг компанийн нийт орлого/зарлагад орохгүй.
// Гүйлгээний жагсаалт нь «Бүх гүйлгээ»-тэй ИЖИЛ /api/dashboard/cash/entries?accountId=… Дансны бүтэн дугаар зөвхөн ADMIN-д.
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { withTiming } from "@/lib/api-timing";
import { authOptions } from "@/lib/auth";
import { requireFinanceAccess } from "@/lib/onec/access";
import { loadCash } from "@/lib/onec/cash";
import { accountPeriod, accountTitles, findAccount, last4, publicId } from "@/lib/onec/cash-accounts";
import { loadAccountSettings } from "@/lib/onec/cash-accounts-store";
import { asOfDate, currentMonth, isDate, isMonth, monthRange, today } from "@/lib/onec/dates";
import { OdataError } from "@/lib/onec/odata-read";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const NO_STORE = { "Cache-Control": "no-store" };
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status, headers: NO_STORE });

export const GET = withTiming("GET /api/dashboard/cash/account", async (req: Request) => {
  const denied = await requireFinanceAccess("cash");
  if (denied) return denied;
  const session = await getServerSession(authOptions);
  const isAdmin = session?.user.role === "ADMIN";

  const sp = new URL(req.url).searchParams;
  const id = sp.get("id") ?? "";
  const now = today();
  const dayRaw = sp.get("day");
  const monthRaw = sp.get("month");
  let month: string;
  let from: string;
  let to: string;
  if (dayRaw) {
    if (!isDate(dayRaw) || dayRaw > now) return bad("day нь YYYY-MM-DD хэлбэртэй, ирээдүйн өдөр биш байх ёстой");
    month = dayRaw.slice(0, 7);
    from = to = dayRaw;
  } else {
    month = monthRaw ?? currentMonth();
    if (!isMonth(month) || month > currentMonth()) return bad("month нь YYYY-MM хэлбэртэй, ирээдүйн сар биш байх ёстой");
    const r = monthRange(month);
    from = r.from;
    to = month === currentMonth() ? now : r.to;
  }

  try {
    const [{ value: cash, meta }, settings] = await Promise.all([loadCash(month, sp.get("refresh") === "1"), loadAccountSettings()]);
    const acc = findAccount(cash, id);
    if (!acc) return bad("Данс олдсонгүй", 404);
    const period = accountPeriod(cash, acc.key, from, to);
    if (!period) return bad("Данс олдсонгүй", 404);
    const { title, subtitle } = accountTitles(acc, settings.get(acc.key));
    return NextResponse.json(
      {
        account: { id: publicId(acc.key), title, subtitle, kind: acc.kind, bank: acc.bank, last4: last4(acc.number), ...(isAdmin && acc.number ? { number: acc.number } : {}), currency: acc.currency },
        period,
        month,
        today: now,
        asOf: asOfDate(month),
        meta: { fetchedAt: new Date(meta.fetchedAt).toISOString(), cached: meta.cached, stale: meta.stale, retryAfterSeconds: meta.retryAfterSeconds ?? null },
      },
      { headers: NO_STORE }
    );
  } catch (e) {
    if (e instanceof OdataError) return NextResponse.json({ error: e.message }, { status: e.status, headers: NO_STORE });
    throw e;
  }
});
