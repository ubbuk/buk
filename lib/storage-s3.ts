import type { S3Client } from "@aws-sdk/client-s3";
import type { ObjectStorage, StoredObjectInfo } from "./storage";

// S3-compatible driver (AWS S3, Cloudflare R2, MinIO, ...) for deployments
// where the local disk is ephemeral or read-only -- e.g. Vercel. Selected with
// STORAGE_DRIVER=s3 (see createStorage in lib/storage.ts). The bucket must be
// PRIVATE: files are only ever served through the authenticated attachments
// API route, never by a bucket URL.

export interface S3StorageOptions {
  bucket: string;
  /** Optional key prefix, e.g. "attachments/". */
  prefix?: string;
  /** Injected in tests; otherwise built lazily from the S3_* environment. */
  client?: Pick<S3Client, "send">;
}

function s3ClientFromEnv(): Promise<Pick<S3Client, "send">> {
  const region = process.env.S3_REGION ?? "auto";
  const endpoint = process.env.S3_ENDPOINT || undefined;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("STORAGE_DRIVER=s3 needs S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY");
  }
  // Imported lazily so the SDK is only loaded when this driver is actually used.
  return import("@aws-sdk/client-s3").then(
    ({ S3Client }) =>
      new S3Client({
        region,
        endpoint,
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
        credentials: { accessKeyId, secretAccessKey },
      })
  );
}

function isNotFound(err: unknown) {
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NoSuchKey" || e?.Code === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404;
}

export class S3Storage implements ObjectStorage {
  private readonly bucket: string;
  private readonly prefix: string;
  private clientPromise: Promise<Pick<S3Client, "send">> | null;

  constructor(options: S3StorageOptions) {
    this.bucket = options.bucket;
    this.prefix = options.prefix ?? "";
    this.clientPromise = options.client ? Promise.resolve(options.client) : null;
  }

  private client() {
    return (this.clientPromise ??= s3ClientFromEnv());
  }

  private objectKey(key: string) {
    // Keys are always server-generated; still refuse anything that could climb out of the prefix.
    if (!key || key.startsWith("/") || key.split("/").includes("..")) throw new Error("Invalid storage key");
    return this.prefix + key;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.client();
    await client.send(new PutObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key), Body: data }));
  }

  async putNew(key: string, data: Buffer): Promise<boolean> {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.client();
    try {
      // Conditional write: S3 / R2 reject it with 412 when the key already exists.
      await client.send(new PutObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key), Body: data, IfNoneMatch: "*" }));
      return true;
    } catch (err) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e?.name === "PreconditionFailed" || e?.$metadata?.httpStatusCode === 412) return false;
      throw err;
    }
  }

  async list(prefix: string): Promise<StoredObjectInfo[]> {
    const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
    const client = await this.client();
    if (prefix.startsWith("/") || prefix.split("/").includes("..")) throw new Error("Invalid storage prefix");
    const out: StoredObjectInfo[] = [];
    let token: string | undefined;
    do {
      const res = await client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: this.prefix + prefix, ContinuationToken: token }));
      for (const o of res.Contents ?? []) {
        if (!o.Key) continue;
        out.push({ key: o.Key.slice(this.prefix.length), size: o.Size ?? 0, lastModified: o.LastModified ?? null });
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  async get(key: string): Promise<Buffer | null> {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.client();
    try {
      const res = await client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }));
      if (!res.Body) return null;
      return Buffer.from(await res.Body.transformToByteArray());
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.client();
    await client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }));
  }
}
