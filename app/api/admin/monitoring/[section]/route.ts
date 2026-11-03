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
import { parseRangeKey, resolveRange } from "@/lib/monitoring/time";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ section: string }> };

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
