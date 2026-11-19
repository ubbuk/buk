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
import { mkdir, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { S3Storage } from "./storage-s3";
import { StorageConfigError, storageEnv } from "./storage-env";

export interface StoredObjectInfo {
  key: string;
  size: number;
  lastModified: Date | null;
}

export interface PresignedPut {
  url: string;
  /** Headers the browser must send with the PUT (they are part of the signature). */
  headers: Record<string, string>;
}

export interface PresignGetOptions {
  contentType: string;
  /** Full Content-Disposition value the object store should answer with. */
  disposition: string;
  expiresIn: number;
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

/** What the attachment flows need on top of the basic object store (direct browser transfers, verification). */
export interface AttachmentStorage extends ObjectStorage {
  /** Size and stored Content-Type of an object, or null when it does not exist. */
  head(key: string): Promise<{ size: number; contentType: string | null } | null>;
  /** The first `length` bytes of an object (for magic-byte checks), or null when it does not exist. */
  readHead(key: string, length: number): Promise<Buffer | null>;
  /**
   * A short-lived URL the browser can PUT the file to directly, bypassing the app server (and Vercel's 4.5 MB request
   * limit). null when the driver cannot do that (local disk): the app then serves its own signed upload route.
   */
  presignPut(key: string, opts: { contentType: string; expiresIn: number }): Promise<PresignedPut | null>;
  /** A short-lived URL the browser can GET the object from, or null when the app must stream it itself. */
  presignGet(key: string, opts: PresignGetOptions): Promise<string | null>;
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

class LocalFsStorage implements AttachmentStorage {
  async head(key: string) {
    try {
      const st = await stat(resolveKeyPath(key));
      return { size: st.size, contentType: null };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async readHead(key: string, length: number): Promise<Buffer | null> {
    let fh;
    try {
      fh = await open(resolveKeyPath(key), "r");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
    try {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await fh.read(buf, 0, length, 0);
      return buf.subarray(0, bytesRead);
    } finally {
      await fh.close();
    }
  }

  async presignPut() {
    return null;
  }

  async presignGet() {
    return null;
  }

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

export { StorageConfigError };

const NOT_CONFIGURED =
  "Файл хадгалах сан тохируулагдаагүй байна (STORAGE_DRIVER). Системийн админд мэдэгдэнэ үү";

/**
 * Which driver the environment asks for. Production never falls back to the local disk by itself: on Vercel the disk
 * is wiped between invocations, so a forgotten STORAGE_DRIVER would silently lose every uploaded file. The local
 * driver therefore has to be asked for explicitly in production (a self-hosted server with a volume) and is refused on Vercel.
 */
export function resolveStorageDriver(env: NodeJS.ProcessEnv = process.env): "local" | "s3" {
  const driver = storageEnv("STORAGE_DRIVER", env);
  if (driver === "s3") return "s3";
  if (!driver) {
    if (env.NODE_ENV === "production" || env.VERCEL) throw new StorageConfigError(NOT_CONFIGURED);
    return "local";
  }
  if (driver === "local") {
    if (env.VERCEL) throw new StorageConfigError("STORAGE_DRIVER=local Vercel дээр ажиллахгүй (диск түр зуурын). STORAGE_DRIVER=s3 тохируулна уу");
    return "local";
  }
  throw new StorageConfigError(`Unknown STORAGE_DRIVER "${driver}" — expected "local" or "s3"`);
}

function createStorage(): AttachmentStorage {
  switch (resolveStorageDriver()) {
    case "local":
      return new LocalFsStorage();
    case "s3": {
      // Any S3-compatible service (AWS S3, Cloudflare R2, MinIO). Required on hosts with an
      // ephemeral/read-only disk such as Vercel. Credentials come from the S3_* env vars.
      const bucket = storageEnv("S3_BUCKET");
      if (!bucket) throw new StorageConfigError("STORAGE_DRIVER=s3 needs S3_BUCKET");
      return new S3Storage({ bucket, prefix: storageEnv("S3_PREFIX") ?? "attachments/" });
    }
  }
}

/** null when uploads can work, otherwise the (Mongolian) reason they cannot. Cheap: callers check it before touching files. */
export function storageConfigProblem(): string | null {
  try {
    g.__objectStorage ??= createStorage();
    return null;
  } catch (err) {
    if (!(err instanceof StorageConfigError)) throw err;
    console.error(`[storage] ${err.message}`);
    return err.message === NOT_CONFIGURED ? err.message : `Файл хадгалах сан буруу тохируулагдсан байна. Системийн админд мэдэгдэнэ үү`;
  }
}

const g = globalThis as unknown as { __objectStorage?: AttachmentStorage };

// Resolved on first use, not at import: `next build` imports every route with NODE_ENV=production and no storage env.
function impl(): AttachmentStorage {
  return (g.__objectStorage ??= createStorage());
}

export const storage: AttachmentStorage = {
  put: async (key, data) => impl().put(key, data),
  putNew: async (key, data) => impl().putNew(key, data),
  get: async (key) => impl().get(key),
  delete: async (key) => impl().delete(key),
  list: async (prefix) => impl().list(prefix),
  head: async (key) => impl().head(key),
  readHead: async (key, length) => impl().readHead(key, length),
  presignPut: async (key, opts) => impl().presignPut(key, opts),
  presignGet: async (key, opts) => impl().presignGet(key, opts),
};

/**
 * Where objects live, for display only (never credentials, never the endpoint
 * URL). Used by the Backup Vault to show an honest storage location/durability.
 */
export function describeStorage(): { driver: "local" | "s3"; location: string; durable: boolean } {
  const driver = storageEnv("STORAGE_DRIVER") || "local";
  if (driver === "s3") {
    return { driver: "s3", location: `S3-compatible bucket "${storageEnv("S3_BUCKET") ?? "?"}" (prefix "${storageEnv("S3_PREFIX") ?? "attachments/"}")`, durable: true };
  }
  // A local disk is fine on a server you control, but is wiped on serverless hosts such as Vercel.
  const serverless = !!process.env.VERCEL;
  // Show the root that is actually in use: LOCAL_STORAGE_ROOT when configured (e.g. a Docker
  // volume), otherwise the built-in default inside the project directory.
  const configured = process.env.LOCAL_STORAGE_ROOT;
  const location = configured ? `Local disk (${configured})` : "Local disk (.storage/attachments/ in the project directory)";
  return { driver: "local", location, durable: !serverless };
}
