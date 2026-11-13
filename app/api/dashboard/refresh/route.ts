// POST /api/dashboard/refresh   { kind: "stock", month?: "2026-11" } | { kind: "month" | "receivables", month?: "2026-11" }
// 1С санхүүгийн самбарын өгөгдлийг 1С-ээс дахин татахыг хүснэ. Энэ нь 1С-ээс ЗӨВХӨН УНШДАГ (GET): 1С руу бичихгүй.
//  - stock: 1С-ээс шууд татна (≤10 сек). 1С-ийг 1 минутад нэгээс илүү дуудахгүй.
//  - month: сарын борлуулалт, P&L, мөнгөн хөрөнгийг ар талд татаж эхэлнэ (хариуг хүлээхгүй). 5 минутын хязгаартай:
//    «Одоо шинэчлэх» товч ч мөн адил. Нэг зэрэг ганцхан татах ажил (lib/onec/refresh.ts).
// Өнгөрсөн сарыг (month < одоогийн сар) зөвхөн ADMIN татна: stock нь тэр сарын эцсийн өдрийн үлдэгдэл, month нь сарын өгөгдөл.
import { getServerSession } from "next-auth";
import { after, NextResponse } from "next/server";
import { z } from "zod";
import { withTiming } from "@/lib/api-timing";
import { authOptions } from "@/lib/auth";
import { requireFinanceAccess } from "@/lib/onec/access";
import { asOfDate, currentMonth, isMonth } from "@/lib/onec/dates";
import { refreshStock, startMonthRefresh } from "@/lib/onec/refresh";
import { DispatchError, heavyRefreshMode } from "@/lib/github-dispatch";
import { requestHeavyRefresh } from "@/lib/onec/refresh-dispatch";
import { startReceivablesRefresh } from "@/lib/onec/receivables-store";

export const dynamic = "force-dynamic";
// Агуулахын шууд татаалт (1С 10 сек + бичилт) ба GitHub Actions-ийг дуудах хүсэлт; хүнд татаалт энд ажиллахгүй (Vercel дээр)
export const maxDuration = 60;

const bodySchema = z.discriminatedUnion("kind", [z.object({ kind: z.literal("stock"), month: z.string().optional() }), z.object({ kind: z.enum(["month", "receivables"]), month: z.string().optional(), kinds: z.array(z.enum(["sales", "pl"])).min(1).max(2).optional(), auto: z.boolean().optional() })]);

// Хариуны дараа ажиллуулна (Vercel дээр ч үргэлжилнэ); request scope-оос гадуур бол шууд эхлүүлнэ
const schedule = (job: () => Promise<void>) => {
  try {
    after(job);
  } catch {
    void job();
  }
};

export const POST = withTiming("POST /api/dashboard/refresh", async (req: Request) => {
  // Нярав зөвхөн агуулахын татаалтыг эхлүүлнэ; сарын (борлуулалт, зардал, мөнгөн хөрөнгө) татаалт удирдлагын эрхтэй
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  const denied = await requireFinanceAccess(!parsed.success ? "sales" : parsed.data.kind === "stock" ? "stock" : parsed.data.kind === "receivables" ? "receivables" : "sales");
  if (denied) return denied;
  if (!parsed.success) return NextResponse.json({ error: "Хүчингүй өгөгдөл" }, { status: 400, headers: { "Cache-Control": "no-store" } });

  const month = parsed.data.month ?? currentMonth();
  if (!isMonth(month) || month > currentMonth()) {
    return NextResponse.json({ error: "month нь YYYY-MM хэлбэртэй, ирээдүйн сар биш байх ёстой" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (month < currentMonth() && (await getServerSession(authOptions))?.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Өнгөрсөн сарыг зөвхөн админ 1С-ээс татна" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  if (parsed.data.kind === "stock") {
    return NextResponse.json(await refreshStock({ date: asOfDate(month) }), { headers: { "Cache-Control": "no-store" } });
  }
  // Vercel: хүнд татаалт (сар, авлагын агшин зураг) route дотор биш GitHub Actions дээр (workflow_dispatch). Агуулах дээрх шиг шууд биш.
  if (heavyRefreshMode() !== "inline") {
    try {
      return NextResponse.json(await requestHeavyRefresh({ kind: parsed.data.kind, month, kinds: parsed.data.kinds, auto: parsed.data.auto }), { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      if (e instanceof DispatchError) return NextResponse.json({ error: "GitHub Actions-ийг дуудаж чадсангүй. Хуваарийн дагуу 15 минутын дотор шинэчлэгдэнэ." }, { status: 502, headers: { "Cache-Control": "no-store" } });
      throw e;
    }
  }
  if (parsed.data.kind === "receivables") {
    // Агшин зургийг ар талд шинэчилнэ (Balance 10-110 сек); хуудас Postgres-оос шууд харуулсаар байна
    return NextResponse.json(await startReceivablesRefresh(asOfDate(month), schedule), { headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json(await startMonthRefresh(month, schedule, undefined, parsed.data.kinds), { headers: { "Cache-Control": "no-store" } });
});
