import { authorize, failure, json } from "@/lib/monitoring/history/api";
import { isValidSnapshotId, verifySnapshot } from "@/lib/monitoring/history/snapshots";

export const dynamic = "force-dynamic";

// POST /api/admin/time-machine/snapshots/<id>/verify -- re-hashes the stored artifact.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(req);
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!isValidSnapshotId(id)) return json({ error: "Snapshot ID буруу" }, 400);
  try {
    return json(await verifySnapshot(id, auth.session.user.id));
  } catch (err) {
    return failure("snapshot verify failed", err);
  }
}
