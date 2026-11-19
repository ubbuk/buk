import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { S3Storage } from "./storage-s3";
import { resolveStorageDriver } from "./storage";
import { classifyStorageError } from "./storage-errors";
import { normalizeEndpoint, storageEnv } from "./storage-env";

// Production incident: S3_REGION was pasted as "\tauto", the SDK refused it ("Region not accepted") and every presign
// answered 500 before any byte reached R2. These tests pin the three fixes: a pasted value is cleaned, a bad setting is a
// clear config error, and a storage problem reaches the user as a sentence with a code in the log (never the value).

const failing = vi.hoisted(() => ({ error: null as unknown }));
vi.mock("./storage", async (importOriginal) => {
  const real = await importOriginal<typeof import("./storage")>();
  const fail = async () => {
    throw failing.error;
  };
  return { ...real, storage: { presignPut: fail, head: fail, readHead: fail, delete: async () => undefined } };
});

const ENV = { S3_ACCESS_KEY_ID: "AKIATEST", S3_SECRET_ACCESS_KEY: "secret", S3_ENDPOINT: "https://0123456789abcdef.r2.cloudflarestorage.com", S3_REGION: "auto" };
beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
});
afterEach(() => vi.unstubAllEnvs());

const presignedUrl = async () => new URL((await new S3Storage({ bucket: "buk-attachments", prefix: "attachments/" }).presignPut("r/k", { contentType: "image/jpeg", expiresIn: 60 })).url);

describe("settings pasted with stray characters", () => {
  it("a tab, newline, BOM or quotes around any S3_* value change nothing", async () => {
    const clean = await presignedUrl();
    vi.stubEnv("S3_REGION", "\tauto");
    vi.stubEnv("S3_ENDPOINT", ' "https://0123456789abcdef.r2.cloudflarestorage.com/"\n');
    vi.stubEnv("S3_ACCESS_KEY_ID", "AKIATEST\r\n");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "\ufeffsecret ");
    const messy = await presignedUrl();
    expect(messy.host).toBe(clean.host);
    expect(messy.searchParams.get("X-Amz-Credential")).toContain("AKIATEST/");
    expect(messy.searchParams.get("X-Amz-Credential")).toContain("/auto/s3/aws4_request");
    expect([...messy.searchParams.keys()].filter((k) => /checksum/i.test(k))).toEqual([]);
  });

  it("STORAGE_DRIVER, S3_BUCKET and prefix are cleaned the same way", () => {
    expect(resolveStorageDriver({ STORAGE_DRIVER: " s3\n" } as unknown as NodeJS.ProcessEnv)).toBe("s3");
    expect(storageEnv("X", { X: "  \t " } as unknown as NodeJS.ProcessEnv)).toBeUndefined();
    expect(storageEnv("X", { X: "'buk-attachments'" } as unknown as NodeJS.ProcessEnv)).toBe("buk-attachments");
  });

  it("an endpoint with a bucket name, or a region that is not a name, is a clear config error, not an SDK crash", async () => {
    expect(normalizeEndpoint("https://acc.r2.cloudflarestorage.com/buk-attachments")).toBeNull();
    expect(normalizeEndpoint("not a url")).toBeNull();
    vi.stubEnv("S3_ENDPOINT", "https://acc.r2.cloudflarestorage.com/buk-attachments");
    await expect(presignedUrl()).rejects.toMatchObject({ name: "Error", message: expect.stringContaining("S3_ENDPOINT") });
    vi.stubEnv("S3_ENDPOINT", ENV.S3_ENDPOINT);
    vi.stubEnv("S3_REGION", "au to");
    const err = await presignedUrl().catch((e) => e);
    expect(classifyStorageError(err).code).toBe("STORAGE_CONFIG");
  });
});

describe("what a storage failure becomes", () => {
  it("is classified by code without the SDK message", () => {
    const c = (e: unknown) => classifyStorageError(e).code;
    expect(c(new Error('Region not accepted: region="\tauto" is not a valid hostname component.'))).toBe("STORAGE_CONFIG");
    expect(c(Object.assign(new Error("x"), { name: "InvalidAccessKeyId" }))).toBe("STORAGE_AUTH");
    expect(c(Object.assign(new Error("x"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } }))).toBe("STORAGE_AUTH");
    expect(c(Object.assign(new Error("x"), { name: "NoSuchBucket" }))).toBe("STORAGE_BUCKET");
    expect(c(Object.assign(new Error("getaddrinfo ENOTFOUND host"), { code: "ENOTFOUND" }))).toBe("STORAGE_UNREACHABLE");
    expect(c(new Error("boom"))).toBe("STORAGE_UNKNOWN");
  });

  it("presign: 503 with a sentence, and only the code in the log", async () => {
    const { presignUploadsSafe } = await import("./attachment-upload");
    failing.error = new Error('Region not accepted: region="\tauto" is not a valid hostname component.');
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const r = await presignUploadsSafe({ prefix: "req/", actorId: "u" }, [{ fileName: "a.jpg", mimeType: "image/jpeg", sizeBytes: 1000 }]);
      expect(r).toEqual({ ok: false, status: 503, error: "Файл хадгалах сангийн тохиргоо буруу байна. Системийн админд мэдэгдэнэ үү" });
      const logged = log.mock.calls.map((c) => String(c[0])).join(" ");
      expect(logged).toContain('"storageFailure":"STORAGE_CONFIG"');
      expect(logged).toContain('"phase":"presign"');
      expect(logged).not.toContain("auto");
    } finally {
      log.mockRestore();
    }
  });
});

describe("finalize when the bucket cannot be asked", () => {
  it("answers 503 with a sentence and the code, and leaves the user free to retry", async () => {
    vi.stubEnv("NEXTAUTH_SECRET", "test-secret");
    const { verifyUploads, signToken } = await import("./attachment-upload");
    failing.error = Object.assign(new Error("denied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } });
    const key = "req-fin/abc";
    const token = signToken({ k: key, m: "image/jpeg", s: 10, u: "u", e: Date.now() + 60_000 });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const r = await verifyUploads({ prefix: "req-fin/", actorId: "u" }, [{ fileName: "a.jpg", key, token }]);
      expect(r).toEqual({ ok: false, status: 503, error: "Файл хадгалах сангийн эрх буруу байна. Системийн админд мэдэгдэнэ үү" });
      expect(log.mock.calls.map((c) => String(c[0])).join(" ")).toContain('"phase":"finalize"');
    } finally {
      log.mockRestore();
    }
  });
});
