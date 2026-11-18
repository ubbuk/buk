// GET /api/dashboard/documents/account?account=6101&month=2026-10&side=debit — тухайн данс дээр бичилт хийсэн баримтууд (Зардал таб: данс -> баримтууд).
// ЗӨВХӨН УНШИХ. Эрх: Зардал таб (удирдлага); нярав харахгүй. Цалингийн баримтууд (canViewPayroll-гүй хүнд) жагсаалтаас хасагдана.
import { NextResponse } from "next/server";
import { withTiming } from "@/lib/api-timing";
import { requireFinanceAccess } from "@/lib/onec/access";
import { isMonth } from "@/lib/onec/dates";
import { canOpenDocument, requireDocViewer } from "@/lib/onec/doc-access";
import { loadAccountDocuments } from "@/lib/onec/documents";
import { OdataError } from "@/lib/onec/odata-read";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const NO_STORE = { "Cache-Control": "no-store" };

export const GET = withTiming("GET /api/dashboard/documents/account", async (req: Request) => {
  const denied = await requireFinanceAccess("expenses");
  if (denied) return denied;
  const auth = await requireDocViewer();
  if (!auth.ok) return auth.res;

  const sp = new URL(req.url).searchParams;
  const account = sp.get("account") ?? "";
  const month = sp.get("month");
  if (!/^[\d.]{3,10}$/.test(account) || !isMonth(month)) return NextResponse.json({ error: "account, month буруу байна" }, { status: 400, headers: NO_STORE });
  const side = sp.get("side") === "credit" ? "credit" : "debit";
  try {
    const { value, meta } = await loadAccountDocuments(account, month, side, sp.get("refresh") === "1");
    const documents = value.filter((d) => canOpenDocument(auth.viewer, d.type, auth.policy));
    return NextResponse.json({ documents, meta: { fetchedAt: new Date(meta.fetchedAt).toISOString(), cached: meta.cached, stale: meta.stale, retryAfterSeconds: meta.retryAfterSeconds ?? null } }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof OdataError) return NextResponse.json({ error: e.message }, { status: e.status, headers: NO_STORE });
    throw e;
  }
});
