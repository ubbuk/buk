import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { withTiming } from "@/lib/api-timing";
import { canViewMonitoring } from "@/lib/monitoring/access";
import { logMonitoringDenied, logMonitoringView } from "@/lib/monitoring/audit";
import {
  getActivity,
  getDepartments,
  getEmployees,
  getOverview,
  getPending,
  getReturned,
  parsePaging,
} from "@/lib/monitoring/queries";
import { parseThresholdHours } from "@/lib/monitoring/procurement-calc";
import { getProcurementList, getProcurementOverview, getProcurementRequestDetail } from "@/lib/monitoring/procurement";
import type { ProcurementFilter, ProcurementScope } from "@/lib/monitoring/procurement-types";
import { parseRangeKey, resolveRange } from "@/lib/monitoring/time";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ section: string }> };

const PROCUREMENT_SCOPES = new Set<ProcurementScope>(["active", "accounting", "completed"]);
const PROCUREMENT_FILTERS = new Set<ProcurementFilter>(["all", "classification", "domestic", "international", "partial", "ready", "delayed"]);

const NO_STORE = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

// Auth is decided here, on the server, for every call. 401 = no session,
// 403 = signed in but not ADMIN/DIRECTOR (and recorded in the audit log).
async function authorize(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return { error: json({ error: "Нэвтрээгүй байна" }, 401) };
  if (!canViewMonitoring(session.user.role)) {
    await logMonitoringDenied(req, session.user.id, session.user.role).catch(() => {});
    return { error: json({ error: "Эрхгүй үйлдэл" }, 403) };
  }
  return { session };
}

export const GET = withTiming("GET /api/admin/monitoring", async (req: Request, { params }: Ctx) => {
  const auth = await authorize(req);
  if (auth.error) return auth.error;

  const { section } = await params;
  const url = new URL(req.url);
  const asOf = new Date();
  const range = resolveRange(parseRangeKey(url.searchParams.get("range")), asOf);
  const { page, pageSize } = parsePaging(url.searchParams);

  try {
    switch (section) {
      case "overview":
        return json(await getOverview(range, asOf));
      case "departments":
        return json(await getDepartments(range, page, pageSize));
      case "employees":
        return json(await getEmployees(range, page, pageSize));
      case "pending":
        return json(await getPending(asOf, page, pageSize));
      case "returned":
        return json(await getReturned(range, page, pageSize));
      case "activity":
        return json(
          await getActivity(range, page, pageSize, {
            action: url.searchParams.get("action"),
            entityType: url.searchParams.get("entityType"),
          })
        );
      // Procurement monitoring: read-only, same ADMIN/DIRECTOR guard and `asOf` convention as above.
      case "procurement":
        return json(await getProcurementOverview(range, asOf, parseThresholdHours(url.searchParams.get("thresholdHours"))));
      case "procurement-requests": {
        const scope = url.searchParams.get("scope") as ProcurementScope;
        const filter = url.searchParams.get("filter") as ProcurementFilter;
        return json(
          await getProcurementList(asOf, {
            scope: PROCUREMENT_SCOPES.has(scope) ? scope : "active",
            filter: PROCUREMENT_FILTERS.has(filter) ? filter : "all",
            q: url.searchParams.get("q")?.slice(0, 100) ?? undefined,
            page,
            pageSize,
            thresholdHours: parseThresholdHours(url.searchParams.get("thresholdHours")),
            range,
          })
        );
      }
      case "procurement-detail": {
        const id = url.searchParams.get("id") ?? "";
        if (!id || id.length > 64) return json({ error: "Олдсонгүй" }, 404);
        const detail = await getProcurementRequestDetail(id, asOf, parseThresholdHours(url.searchParams.get("thresholdHours")));
        return detail ? json(detail) : json({ error: "Энэ захиалга худалдан авалтын шатанд ороогүй байна" }, 404);
      }
      default:
        return json({ error: "Олдсонгүй" }, 404);
    }
  } catch (err) {
    console.error("monitoring query failed", section, err instanceof Error ? err.message : err);
    return json({ error: "Мэдээлэл ачаалахад алдаа гарлаа" }, 500);
  }
});

// POST /api/admin/monitoring/view -- called once when the page opens.
export const POST = withTiming("POST /api/admin/monitoring", async (req: Request, { params }: Ctx) => {
  const { section } = await params;
  if (section !== "view") return json({ error: "Олдсонгүй" }, 404);
  const auth = await authorize(req);
  if (auth.error) return auth.error;
  await logMonitoringView(req, auth.session.user.id);
  return json({ ok: true });
});
