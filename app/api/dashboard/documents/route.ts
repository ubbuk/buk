// GET /api/dashboard/documents?from=2026-11-01&to=2026-11-30&kinds=receipt,transfer[&party=00-001177][&refresh=1]
// Хугацааны хүрээн дэх 1С-ийн баримтуудын картууд (ЗӨВХӨН УНШИХ, 1С-ээс шууд, 5 минутын cache). Шүүлтүүр (агуулах, төрөл, хайлт) клиент талд.
// Эрх: lib/onec/doc-access.ts (нярав зөвхөн агуулахын баримт; хориотой төрөл жагсаалтад ордоггүй).
import { NextResponse } from "next/server";
import { withTiming } from "@/lib/api-timing";
import { isDate } from "@/lib/onec/dates";
import { allowedKinds, requireDocViewer } from "@/lib/onec/doc-access";
import { DOC_KIND_KEYS, isDocKind } from "@/lib/onec/doc-kinds";
import { loadDocuments } from "@/lib/onec/documents";
import { OdataError } from "@/lib/onec/odata-read";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const NO_STORE = { "Cache-Control": "no-store" };

export const GET = withTiming("GET /api/dashboard/documents", async (req: Request) => {
  const auth = await requireDocViewer();
  if (!auth.ok) return auth.res;

  const sp = new URL(req.url).searchParams;
  const from = sp.get("from");
  const to = sp.get("to");
  if (!isDate(from) || !isDate(to) || from > to) return NextResponse.json({ error: "from, to нь YYYY-MM-DD хэлбэртэй байх ёстой" }, { status: 400, headers: NO_STORE });
  const requested = (sp.get("kinds") ?? DOC_KIND_KEYS.join(",")).split(",").filter(isDocKind);
  if (requested.length === 0) return NextResponse.json({ error: "Баримтын төрөл буруу байна" }, { status: 400, headers: NO_STORE });
  const kinds = allowedKinds(auth.viewer, requested, auth.policy);
  if (kinds.length === 0) return NextResponse.json({ error: "Энэ мэдээллийг үзэх эрхгүй" }, { status: 403, headers: NO_STORE });

  try {
    const { value, meta } = await loadDocuments({ from, to, kinds, partyCode: sp.get("party") }, sp.get("refresh") === "1");
    return NextResponse.json({ documents: value, kinds, meta: { fetchedAt: new Date(meta.fetchedAt).toISOString(), cached: meta.cached, stale: meta.stale, retryAfterSeconds: meta.retryAfterSeconds ?? null } }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof OdataError) return NextResponse.json({ error: e.message }, { status: e.status, headers: NO_STORE });
    throw e;
  }
});
