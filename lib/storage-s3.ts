import type { S3Client } from "@aws-sdk/client-s3";
import { normalizeEndpoint, StorageConfigError, storageEnv, validRegion } from "./storage-env";
import type { AttachmentStorage, PresignedPut, PresignGetOptions, StoredObjectInfo } from "./storage";

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
  const region = storageEnv("S3_REGION") ?? "auto";
  const rawEndpoint = storageEnv("S3_ENDPOINT");
  const endpoint = rawEndpoint === undefined ? undefined : normalizeEndpoint(rawEndpoint);
  const accessKeyId = storageEnv("S3_ACCESS_KEY_ID");
  const secretAccessKey = storageEnv("S3_SECRET_ACCESS_KEY");
  if (!accessKeyId || !secretAccessKey) {
    throw new StorageConfigError("STORAGE_DRIVER=s3 needs S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY");
  }
  if (!validRegion(region)) throw new StorageConfigError("Invalid region: S3_REGION must be a plain name such as auto");
  if (rawEndpoint !== undefined && endpoint === null) throw new StorageConfigError("Invalid endpoint: S3_ENDPOINT must be https://<account>.r2.cloudflarestorage.com with no bucket name");
  // Imported lazily so the SDK is only loaded when this driver is actually used.
  return import("@aws-sdk/client-s3").then(
    ({ S3Client }) =>
      new S3Client({
        region,
        endpoint: endpoint ?? undefined,
        forcePathStyle: storageEnv("S3_FORCE_PATH_STYLE") === "true",
        // R2 (and MinIO) do not understand the CRC32 trailer the SDK adds by default since 3.729: with it a presigned PUT
        // carries x-amz-checksum headers the browser cannot compute and the upload is rejected.
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
        credentials: { accessKeyId, secretAccessKey },
      })
  );
}

function isNotFound(err: unknown) {
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NoSuchKey" || e?.Code === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404;
}

export class S3Storage implements AttachmentStorage {
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

  async head(key: string) {
    const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.client();
    try {
      const res = await client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }));
      return { size: res.ContentLength ?? 0, contentType: res.ContentType ?? null };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async readHead(key: string, length: number): Promise<Buffer | null> {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.client();
    try {
      const res = await client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key), Range: `bytes=0-${length - 1}` }));
      if (!res.Body) return null;
      return Buffer.from(await res.Body.transformToByteArray());
    } catch (err) {
      if (isNotFound(err)) return null;
      // An empty object has no byte 0: that is an empty file, not a failure.
      if ((err as { name?: string })?.name === "InvalidRange") return Buffer.alloc(0);
      throw err;
    }
  }

  async presignPut(key: string, opts: { contentType: string; expiresIn: number }): Promise<PresignedPut> {
    const [{ PutObjectCommand }, { getSignedUrl }] = await Promise.all([import("@aws-sdk/client-s3"), import("@aws-sdk/s3-request-presigner")]);
    const client = (await this.client()) as S3Client;
    // Content-Type is signed: the browser must send exactly this header, so a file cannot be stored under another type.
    const url = await getSignedUrl(client, new PutObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key), ContentType: opts.contentType }), {
      expiresIn: opts.expiresIn,
      // The presigner signs only `host` unless told otherwise, so without this the Content-Type header would be unchecked.
      signableHeaders: new Set(["content-type"]),
    });
    return { url, headers: { "Content-Type": opts.contentType } };
  }

  async presignGet(key: string, opts: PresignGetOptions): Promise<string> {
    const [{ GetObjectCommand }, { getSignedUrl }] = await Promise.all([import("@aws-sdk/client-s3"), import("@aws-sdk/s3-request-presigner")]);
    const client = (await this.client()) as S3Client;
    return getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key), ResponseContentType: opts.contentType, ResponseContentDisposition: opts.disposition }),
      { expiresIn: opts.expiresIn }
    );
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
