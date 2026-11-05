import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { listProcurement, procurementCounts, type ProcurementKind, type ProcurementTab, type PurchaseStatus } from "@/lib/procurement";
import { withTiming } from "@/lib/api-timing";

export const dynamic = "force-dynamic";

const TABS = new Set<ProcurementTab>(["classify", "awaiting", "in_progress", "completed", "all"]);
const KINDS = new Set<ProcurementKind>(["DOMESTIC", "INTERNATIONAL"]);
const ITEM_STATUSES = new Set<PurchaseStatus>(["NOT_STARTED", "PARTIAL", "COMPLETE"]);

const optNumber = (v: string | null) => {
  if (v === null || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const optDate = (v: string | null, endOfDay = false) => {
  if (!v || !/^\d{4}-\d{2}-\d{2}/.test(v)) return undefined;
  const d = new Date(`${v.slice(0, 10)}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

// Manager procurement dashboard data: tabs, counts and backend search with
// pagination. MANAGER works it; ADMIN may look (oversight) but every write
// endpoint is MANAGER-only. Nobody else gets in -- this is not request
// visibility, it is a procurement view of every request that reached Stage 7.
// A manager sees "their" requests (an item assigned to them, or -- for the
// International manager -- still to classify) unless they ask for scope=all
// (shared coordination context); ADMIN always sees everything.
export const GET = withTiming("GET /api/procurement", async (req: Request) => {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });
  if (session.user.role !== "MANAGER" && session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });
  }

  const sp = new URL(req.url).searchParams;
  const tab = (TABS.has(sp.get("tab") as ProcurementTab) ? sp.get("tab") : "awaiting") as ProcurementTab;
  const itemStatus = ITEM_STATUSES.has(sp.get("itemStatus") as PurchaseStatus) ? (sp.get("itemStatus") as PurchaseStatus) : undefined;

  const isAdmin = session.user.role === "ADMIN";
  const scope = isAdmin || sp.get("scope") === "all" ? "all" : "mine";
  const kind = KINDS.has(sp.get("kind") as ProcurementKind) ? (sp.get("kind") as ProcurementKind) : undefined;

  const [list, counts] = await Promise.all([
    listProcurement({
      tab,
      scope,
      kind,
      viewerId: session.user.id,
      viewerRole: session.user.role,
      // "actionable=1": exactly the requests the sidebar badge counts for this user
      actionable: sp.get("actionable") === "1",
      q: sp.get("q") ?? undefined,
      page: Math.max(1, Number(sp.get("page")) || 1),
      pageSize: Number(sp.get("pageSize")) || 20,
      dateFrom: optDate(sp.get("dateFrom")),
      dateTo: optDate(sp.get("dateTo"), true),
      qtyMin: optNumber(sp.get("qtyMin")),
      qtyMax: optNumber(sp.get("qtyMax")),
      priceMin: optNumber(sp.get("priceMin")),
      priceMax: optNumber(sp.get("priceMax")),
      itemStatus,
    }),
    procurementCounts({ id: session.user.id, scope, role: session.user.role }),
  ]);
  const isInternational = list.managers.international?.id === session.user.id;
  return NextResponse.json({ ...list, counts, scope, viewer: { isInternational, isDomestic: list.managers.domestic?.id === session.user.id, isAdmin } });
});
