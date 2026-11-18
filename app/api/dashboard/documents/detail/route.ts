// GET /api/dashboard/documents/detail?type=ПоступлениеТоваровУслуг&ref=<GUID> — баримтын дэлгэрэнгүй (толгой, мөрүүд, НӨАТ, нийт, бичилт).
// Баримтыг (төрөл, GUID)-аар тодорхойлно: дугаар нь төрөл хооронд давхардана. ЗӨВХӨН УНШИХ.
import { NextResponse } from "next/server";
import { withTiming } from "@/lib/api-timing";
import { canOpenDocument, canSeePostings, requireDocViewer } from "@/lib/onec/doc-access";
import { loadDocumentDetail } from "@/lib/onec/documents";
import { OdataError } from "@/lib/onec/odata-read";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const NO_STORE = { "Cache-Control": "no-store" };

export const GET = withTiming("GET /api/dashboard/documents/detail", async (req: Request) => {
  const auth = await requireDocViewer();
  if (!auth.ok) return auth.res;

  const sp = new URL(req.url).searchParams;
  const type = sp.get("type") ?? "";
  const ref = sp.get("ref") ?? "";
  if (!/^[\p{L}\d_]{1,80}$/u.test(type) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref)) {
    return NextResponse.json({ error: "Баримтын лавлагаа буруу байна" }, { status: 400, headers: NO_STORE });
  }
  if (!canOpenDocument(auth.viewer, type, auth.policy)) return NextResponse.json({ error: "Энэ баримтыг үзэх эрхгүй" }, { status: 403, headers: NO_STORE });

  try {
    const { value, meta } = await loadDocumentDetail(type, ref, { withPostings: canSeePostings(auth.viewer), hidePayroll: auth.viewer.canViewPayroll !== true });
    return NextResponse.json({ ...value, meta: { fetchedAt: new Date(meta.fetchedAt).toISOString(), cached: meta.cached, stale: meta.stale, retryAfterSeconds: meta.retryAfterSeconds ?? null } }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof OdataError) return NextResponse.json({ error: e.message }, { status: e.status, headers: NO_STORE });
    throw e;
  }
});
