// GET /api/dashboard/usage?month=2026-10[&refresh=1] — Шаардах хуудасны зарцуулалт (1С-ээс шууд, ЗӨВХӨН УНШИХ).
// 5 минутын cache; refresh=1 нь cache-ийг тойрно, гэхдээ хамгийн багадаа 60 сек тутамд (lib/onec/odata-cache.ts).
// Хариунд: өмнөх сарын мөн үетэй харьцуулалт (comparison, daily[].previous; өмнөх сарыг татаж чадаагүй бол null) ба агуулахаар (byWarehouse:
// 1С склад → Warehouse.onecCode → нярвын бүлэг, нярав).
// Эрх: удирдлага болон нярав (Зарцуулалт таб).
import { NextResponse } from "next/server";
import { withTiming } from "@/lib/api-timing";
import { requireFinanceAccess } from "@/lib/onec/access";
import { prisma } from "@/lib/prisma";
import { addMonths, currentMonth, isMonth, today } from "@/lib/onec/dates";
import { OdataError } from "@/lib/onec/odata-read";
import { loadUsage } from "@/lib/onec/usage";
import { compareUsage, usageByWarehouse } from "@/lib/onec/usage-compare";
import { buildUsageView } from "@/lib/onec/usage-view";
import type { WarehouseRow } from "@/lib/onec/stock-tree";

export const dynamic = "force-dynamic";
// 1С OData дуудлага бүр 30 сек хүртэл (lib/onec-odata/config.ts), Vercel-ийн анхдагч хязгаараас хамаарахгүй
export const maxDuration = 60;
const NO_STORE = { "Cache-Control": "no-store" };

export const GET = withTiming("GET /api/dashboard/usage", async (req: Request) => {
  const denied = await requireFinanceAccess("usage");
  if (denied) return denied;

  const sp = new URL(req.url).searchParams;
  const month = sp.get("month") ?? currentMonth();
  if (!isMonth(month)) return NextResponse.json({ error: "month нь YYYY-MM хэлбэртэй байх ёстой" }, { status: 400 });

  try {
    const refresh = sp.get("refresh") === "1";
    // Өмнөх сар (cache-тай) зэрэг: татаж чадахгүй бол харьцуулалтгүй, хуудас унахгүй
    const [{ value, meta }, previous, warehouseRows] = await Promise.all([
      loadUsage(month, refresh),
      loadUsage(addMonths(month, -1)).then((r) => r.value, () => null),
      prisma.warehouse.findMany({ select: { id: true, name: true, onecCode: true, parentId: true, reservable: true, keeperId: true, keeper: { select: { name: true } } } }),
    ]);
    const warehouses: WarehouseRow[] = warehouseRows.map((w) => ({ id: w.id, name: w.name, onecCode: w.onecCode, parentId: w.parentId, reservable: w.reservable, keeperId: w.keeperId, keeperName: w.keeper?.name ?? null }));
    const { comparison, daily } = compareUsage(value, previous, month === currentMonth() ? today() : null);
    // Олголтын баримтын «Комментарий» (зориулалт) хэзээ ч гарахгүй: хүний нэр агуулж болно
    const documents = value.documents.map((d) => ({ ...d, purpose: "" }));
    return NextResponse.json({ ...value, documents, view: buildUsageView(value.byDepartment, value.byMaterial, value.deptMaterials), daily, comparison, byWarehouse: usageByWarehouse(value.documents, warehouses), meta: { fetchedAt: new Date(meta.fetchedAt).toISOString(), cached: meta.cached, stale: meta.stale, retryAfterSeconds: meta.retryAfterSeconds ?? null } }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof OdataError) return NextResponse.json({ error: e.message }, { status: e.status, headers: NO_STORE });
    throw e;
  }
});
