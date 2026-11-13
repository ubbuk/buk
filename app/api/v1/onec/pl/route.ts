// GET /api/v1/onec/pl?from=yyyy-MM-dd&to=yyyy-MM-dd   (Authorization: Bearer <ONEC_HUB_API_KEY>)
// 1С-ийн /hs/dash/pl-тай ижил параметр, хариулт. Зөвхөн унших; NextAuth session шаардахгүй (server-to-server).
import { withTiming } from "@/lib/api-timing";
import { envelope, hubJson, lastSyncedAt, parseRange, requireHubKey } from "@/lib/onec/hub";
import { plRows } from "@/lib/onec/hub-queries";

export const dynamic = "force-dynamic";

export const GET = withTiming("GET /api/v1/onec/pl", async (req: Request) => {
  const denied = requireHubKey(req);
  if (denied) return denied;

  const range = parseRange(new URL(req.url).searchParams);
  if ("error" in range) return range.error;

  const [rows, syncedAt] = await Promise.all([plRows(range.value.from, range.value.to), lastSyncedAt("pl")]);
  return hubJson(envelope(rows, syncedAt));
});
