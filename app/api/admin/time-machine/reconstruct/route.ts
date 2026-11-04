import { reconstruct } from "@/lib/monitoring/history/reconstruct";
import { authorize, failure, json, parseAsOf } from "@/lib/monitoring/history/api";

export const dynamic = "force-dynamic";

// GET /api/admin/time-machine/reconstruct?asOf=<ISO timestamp>
// Read-only: reconstructs request states from the audit log at that moment.
// Nothing is stored. The request list is trimmed for the browser; the totals
// and the completeness verdict always cover every request.
const MAX_ROWS = 500;

export async function GET(req: Request) {
  const auth = await authorize(req);
  if (auth.error) return auth.error;

  const asOf = parseAsOf(new URL(req.url).searchParams.get("asOf"));
  if (!asOf) return json({ error: "asOf нь ISO огноо (жишээ 2026-11-02T06:00:00Z) байх ёстой бөгөөд ирээдүйд байж болохгүй" }, 400);

  try {
    const { result } = await reconstruct(asOf);
    // Longest-waiting first, then flagged requests, so the interesting rows survive the trim.
    const ordered = [...result.requests].sort(
      (a, b) => (b.waitingSeconds ?? -1) - (a.waitingSeconds ?? -1) || b.flags.length - a.flags.length || (a.requestNumber < b.requestNumber ? -1 : 1)
    );
    return json({ ...result, requests: ordered.slice(0, MAX_ROWS), requestsTotal: result.requests.length });
  } catch (err) {
    return failure("time-machine reconstruct failed", err);
  }
}
