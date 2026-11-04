// Private object storage for request attachments. Never under app/public —
// every read goes through an authenticated API route (see
// app/api/requests/[id]/attachments/[attachmentId]/route.ts), so a file can
// never be reached by a bare public URL (spec: "attachments must not be
// exposed via a public URL").
//
// Swappable by design: everything in this app talks to the `ObjectStorage`
// interface below, never to the filesystem directly. The only implementation
// here is the local-disk driver this dev environment needs; a production
// driver (S3, Azure Blob, GCS...) would be a second file implementing the
// same three methods and selected below via STORAGE_DRIVER — no other file
// in the app would need to change.
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { S3Storage } from "./storage-s3";

export interface StoredObjectInfo {
  key: string;
  size: number;
  lastModified: Date | null;
}

export interface ObjectStorage {
  put(key: string, data: Buffer): Promise<void>;
  /**
   * Writes only if `key` does not exist yet. Returns false (and changes nothing)
   * when it already did -- used for immutable artifacts such as historical snapshots.
   */
  putNew(key: string, data: Buffer): Promise<boolean>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  /** Every object whose key starts with `prefix`, sorted by key. */
  list(prefix: string): Promise<StoredObjectInfo[]>;
}

// Project-root-relative, gitignored, outside app/public. Overridable so
// tests can point it at a throwaway directory.
const LOCAL_STORAGE_ROOT = process.env.LOCAL_STORAGE_ROOT ?? path.join(process.cwd(), ".storage", "attachments");

function resolveKeyPath(key: string): string {
  // Attachment keys are always server-generated (crypto.randomUUID()-based,
  // see lib/attachments.ts) and never taken from user input, but resolve
  // and verify containment anyway as a defense-in-depth guard against path
  // traversal if that ever changes.
  const resolved = path.resolve(LOCAL_STORAGE_ROOT, key);
  if (!resolved.startsWith(path.resolve(LOCAL_STORAGE_ROOT) + path.sep)) {
    throw new Error("Invalid storage key");
  }
  return resolved;
}

class LocalFsStorage implements ObjectStorage {
  async put(key: string, data: Buffer): Promise<void> {
    const filePath = resolveKeyPath(key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, data);
  }

  async putNew(key: string, data: Buffer): Promise<boolean> {
    const filePath = resolveKeyPath(key);
    await mkdir(path.dirname(filePath), { recursive: true });
    try {
      await writeFile(filePath, data, { flag: "wx" }); // fails if the file exists
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw err;
    }
  }

  async list(prefix: string): Promise<StoredObjectInfo[]> {
    const root = path.resolve(LOCAL_STORAGE_ROOT);
    const out: StoredObjectInfo[] = [];
    const walk = async (dir: string) => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
        throw err;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          await walk(full);
        } else if (e.isFile()) {
          const key = path.relative(root, full).split(path.sep).join("/");
          if (key.startsWith(prefix)) {
            const st = await stat(full);
            out.push({ key, size: st.size, lastModified: st.mtime });
          }
        }
      }
    };
    // Start from the deepest directory the prefix names; the startsWith check does the rest.
    const dirPart = prefix.includes("/") ? prefix.slice(0, prefix.lastIndexOf("/")) : "";
    await walk(dirPart ? resolveKeyPath(dirPart) : root);
    return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(resolveKeyPath(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(resolveKeyPath(key), { force: true });
  }
}

function createStorage(): ObjectStorage {
  const driver = process.env.STORAGE_DRIVER ?? "local";
  switch (driver) {
    case "local":
      return new LocalFsStorage();
    case "s3": {
      // Any S3-compatible service (AWS S3, Cloudflare R2, MinIO). Required on hosts with an
      // ephemeral/read-only disk such as Vercel. Credentials come from the S3_* env vars.
      const bucket = process.env.S3_BUCKET;
      if (!bucket) throw new Error("STORAGE_DRIVER=s3 needs S3_BUCKET");
      return new S3Storage({ bucket, prefix: process.env.S3_PREFIX ?? "attachments/" });
    }
    default:
      throw new Error(`Unknown STORAGE_DRIVER "${driver}" — expected "local" or "s3"`);
  }
}

const g = globalThis as unknown as { __objectStorage?: ObjectStorage };
export const storage = g.__objectStorage ?? (g.__objectStorage = createStorage());

/**
 * Where objects live, for display only (never credentials, never the endpoint
 * URL). Used by the Backup Vault to show an honest storage location/durability.
 */
export function describeStorage(): { driver: "local" | "s3"; location: string; durable: boolean } {
  const driver = process.env.STORAGE_DRIVER ?? "local";
  if (driver === "s3") {
    return { driver: "s3", location: `S3-compatible bucket "${process.env.S3_BUCKET ?? "?"}" (prefix "${process.env.S3_PREFIX ?? "attachments/"}")`, durable: true };
  }
  // A local disk is fine on a server you control, but is wiped on serverless hosts such as Vercel.
  const serverless = !!process.env.VERCEL;
  // Show the root that is actually in use: LOCAL_STORAGE_ROOT when configured (e.g. a Docker
  // volume), otherwise the built-in default inside the project directory.
  const configured = process.env.LOCAL_STORAGE_ROOT;
  const location = configured ? `Local disk (${configured})` : "Local disk (.storage/attachments/ in the project directory)";
  return { driver: "local", location, durable: !serverless };
}
