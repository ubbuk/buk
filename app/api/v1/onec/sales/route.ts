// GET /api/v1/onec/sales?from=yyyy-MM-dd&to=yyyy-MM-dd   (Authorization: Bearer <ONEC_HUB_API_KEY>)
// 1С-ийн /hs/dash/sales-тай ижил параметр, хариулт. Зөвхөн унших; NextAuth session шаардахгүй (server-to-server).
import { withTiming } from "@/lib/api-timing";
import { envelope, hubJson, lastSyncedAt, parseRange, requireHubKey } from "@/lib/onec/hub";
import { salesRows } from "@/lib/onec/hub-queries";

export const dynamic = "force-dynamic";

export const GET = withTiming("GET /api/v1/onec/sales", async (req: Request) => {
  const denied = requireHubKey(req);
  if (denied) return denied;

  const range = parseRange(new URL(req.url).searchParams);
  if ("error" in range) return range.error;

  const [rows, syncedAt] = await Promise.all([salesRows(range.value.from, range.value.to), lastSyncedAt("sales")]);
  return hubJson(envelope(rows, syncedAt));
});
