import { authorize, failure, json, parseAsOf } from "@/lib/monitoring/history/api";
import { createSnapshot, listSnapshots } from "@/lib/monitoring/history/snapshots";

export const dynamic = "force-dynamic";

// GET  /api/admin/time-machine/snapshots        list snapshots + storage status
// POST /api/admin/time-machine/snapshots {asOf} create an immutable historical snapshot
export async function GET(req: Request) {
  const auth = await authorize(req);
  if (auth.error) return auth.error;
  try {
    return json(await listSnapshots());
  } catch (err) {
    return failure("snapshot list failed", err);
  }
}

export async function POST(req: Request) {
  const auth = await authorize(req);
  if (auth.error) return auth.error;
  const body = (await req.json().catch(() => null)) as { asOf?: unknown } | null;
  const asOf = parseAsOf(body?.asOf);
  if (!asOf) return json({ error: "asOf нь ISO огноо байх ёстой бөгөөд ирээдүйд байж болохгүй" }, 400);
  try {
    return json(await createSnapshot(asOf, auth.session.user.id), 201);
  } catch (err) {
    return failure("snapshot create failed", err);
  }
}
