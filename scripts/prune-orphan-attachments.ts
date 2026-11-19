// Lists (and with --delete removes) objects in the attachment storage that no Attachment / ForeignTradeAttachment row
// points to: files from uploads that were abandoned between "PUT to the bucket" and "register". Dry run by default.
//
//   npx tsx --env-file=.env scripts/prune-orphan-attachments.ts            # report only
//   npx tsx --env-file=.env scripts/prune-orphan-attachments.ts --delete   # remove them
//
// Only objects older than 24 h are considered, so an upload in progress is never touched. It reads the database named by
// DATABASE_URL: point it at the database that belongs to the storage you are cleaning.
import { prisma } from "../lib/prisma";
import { storage } from "../lib/storage";

const MIN_AGE_MS = 24 * 60 * 60 * 1000;

async function main() {
  const doDelete = process.argv.includes("--delete");
  const [a, b] = await Promise.all([
    prisma.attachment.findMany({ select: { storageKey: true, thumbKey: true } }),
    prisma.foreignTradeAttachment.findMany({ select: { storageKey: true, thumbKey: true } }),
  ]);
  const known = new Set([...a, ...b].flatMap((r) => [r.storageKey, r.thumbKey]).filter((k): k is string => !!k));

  const objects = await storage.list("");
  // Snapshots of the monitoring history share the bucket under their own prefix; leave anything that is not an attachment key.
  const candidates = objects.filter((o) => !known.has(o.key) && o.lastModified && Date.now() - o.lastModified.getTime() > MIN_AGE_MS && /^(foreign-trade\/)?[^/]+\/[^/]+$/.test(o.key) && !o.key.startsWith("snapshots/"));
  const bytes = candidates.reduce((n, o) => n + o.size, 0);
  console.log(`${objects.length} objects in storage, ${known.size} referenced, ${candidates.length} orphaned (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
  for (const o of candidates) console.log(`${doDelete ? "delete" : "orphan"} ${o.key} (${o.size} B, ${o.lastModified?.toISOString()})`);
  if (doDelete) for (const o of candidates) await storage.delete(o.key);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
