// GET /api/dashboard/documents/item?code=00-00001640|key=<GUID>&from=2026-10-01&to=2026-11-18 — барааны түүх: баримт бүрээр орсон, гарсан,
// агуулах бүрийн одоогийн үлдэгдэл. ЗӨВХӨН УНШИХ. Эрх: удирдлага ба нярав (Агуулах, Зарцуулалт табаас).
import { NextResponse } from "next/server";
import { withTiming } from "@/lib/api-timing";
import { isDate } from "@/lib/onec/dates";
import { requireDocViewer } from "@/lib/onec/doc-access";
import { loadItemHistory } from "@/lib/onec/documents";
import { OdataError } from "@/lib/onec/odata-read";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const NO_STORE = { "Cache-Control": "no-store" };

export const GET = withTiming("GET /api/dashboard/documents/item", async (req: Request) => {
  const auth = await requireDocViewer();
  if (!auth.ok) return auth.res;

  const sp = new URL(req.url).searchParams;
  const from = sp.get("from");
  const to = sp.get("to");
  if (!isDate(from) || !isDate(to) || from > to) return NextResponse.json({ error: "from, to нь YYYY-MM-DD хэлбэртэй байх ёстой" }, { status: 400, headers: NO_STORE });
  try {
    const { value, meta } = await loadItemHistory({ key: sp.get("key"), code: sp.get("code"), from, to });
    return NextResponse.json({ ...value, meta: { fetchedAt: new Date(meta.fetchedAt).toISOString(), cached: meta.cached, stale: meta.stale, retryAfterSeconds: meta.retryAfterSeconds ?? null } }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof OdataError) return NextResponse.json({ error: e.message }, { status: e.status, headers: NO_STORE });
    throw e;
  }
});
