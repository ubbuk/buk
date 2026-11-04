import { authorize, failure, json } from "@/lib/monitoring/history/api";
import { isValidSnapshotId, testRestoreSnapshot } from "@/lib/monitoring/history/snapshots";

export const dynamic = "force-dynamic";

// POST /api/admin/time-machine/snapshots/<id>/test-restore
// In-memory validation + deterministic re-computation. It reads no database and
// restores nothing into PostgreSQL (a full database restore is a separate, not
// yet approved capability).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(req);
  if (auth.error) return auth.error;
  const { id } = await params;
  if (!isValidSnapshotId(id)) return json({ error: "Snapshot ID буруу" }, 400);
  try {
    return json(await testRestoreSnapshot(id, auth.session.user.id));
  } catch (err) {
    return failure("snapshot restore-test failed", err);
  }
}
