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
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface ObjectStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
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
    default:
      throw new Error(`Unknown STORAGE_DRIVER "${driver}" — only "local" is implemented`);
  }
}

const g = globalThis as unknown as { __objectStorage?: ObjectStorage };
export const storage = g.__objectStorage ?? (g.__objectStorage = createStorage());
