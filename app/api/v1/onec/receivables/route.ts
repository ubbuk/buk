// GET /api/v1/onec/receivables?asof=yyyy-MM-dd   (Authorization: Bearer <ONEC_HUB_API_KEY>)
// 1С-ийн /hs/dash/receivables-тай ижил параметр, хариулт. Зөвхөн унших; NextAuth session шаардахгүй (server-to-server).
// asof-ийн агшин зураг байхгүй бол хамгийн сүүлийнхийг буцааж, "asof"-д бодит огноог бичнэ (огт байхгүй бол null).
import { withTiming } from "@/lib/api-timing";
import { envelope, hubJson, lastSyncedAt, parseAsof, requireHubKey } from "@/lib/onec/hub";
import { receivablesRows, receivablesSnapshot } from "@/lib/onec/hub-queries";

export const dynamic = "force-dynamic";

export const GET = withTiming("GET /api/v1/onec/receivables", async (req: Request) => {
  const denied = requireHubKey(req);
  if (denied) return denied;

  const parsed = parseAsof(new URL(req.url).searchParams);
  if ("error" in parsed) return parsed.error;

  const snapshot = await receivablesSnapshot(parsed.value);
  const [rows, syncedAt] = await Promise.all([snapshot ? receivablesRows(snapshot) : Promise.resolve([]), lastSyncedAt("receivables")]);
  return hubJson(envelope(rows, syncedAt, { asof: snapshot }));
});
