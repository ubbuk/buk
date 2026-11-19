import { describe, expect, it } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";
import { S3Storage } from "./storage-s3";

// The AWS SDK's network layer is replaced by an in-memory fake `send`; the
// driver's own logic (key prefixing, not-found handling, traversal guard) is real.
function fakeClient() {
  const objects = new Map<string, Buffer>();
  const calls: string[] = [];
  const client = {
    async send(command: { constructor: { name: string }; input: { Bucket: string; Key: string; Body?: Buffer; Range?: string } }) {
      const name = command.constructor.name;
      const { Bucket, Key, Body } = command.input;
      calls.push(`${name} ${Bucket}/${Key}`);
      if (name === "PutObjectCommand") {
        objects.set(`${Bucket}/${Key}`, Body as Buffer);
        return {};
      }
      if (name === "HeadObjectCommand") {
        const data = objects.get(`${Bucket}/${Key}`);
        if (!data) throw Object.assign(new Error("NotFound"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
        return { ContentLength: data.length, ContentType: "application/pdf" };
      }
      if (name === "GetObjectCommand") {
        const data = objects.get(`${Bucket}/${Key}`);
        if (!data) throw Object.assign(new Error("missing"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
        const range = /^bytes=(\d+)-(\d+)$/.exec(command.input.Range ?? "");
        const part = range ? data.subarray(Number(range[1]), Number(range[2]) + 1) : data;
        return { Body: { transformToByteArray: async () => new Uint8Array(part) } };
      }
      if (name === "DeleteObjectCommand") {
        objects.delete(`${Bucket}/${Key}`);
        return {};
      }
      throw new Error(`unexpected ${name}`);
    },
  };
  return { client, objects, calls };
}

describe("S3Storage", () => {
  it("round-trips a file under the configured prefix", async () => {
    const { client, objects, calls } = fakeClient();
    const s = new S3Storage({ bucket: "erp", prefix: "attachments/", client: client as never });
    await s.put("req1/abc", Buffer.from("hello"));
    expect([...objects.keys()]).toEqual(["erp/attachments/req1/abc"]);
    expect((await s.get("req1/abc"))?.toString()).toBe("hello");
    await s.delete("req1/abc");
    expect(await s.get("req1/abc")).toBeNull(); // NoSuchKey -> null, like the local driver
    expect(calls[0]).toBe("PutObjectCommand erp/attachments/req1/abc");
  });

  it("rethrows real errors instead of reporting a missing file", async () => {
    const s = new S3Storage({
      bucket: "erp",
      client: { send: async () => { throw Object.assign(new Error("denied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } }); } } as never,
    });
    await expect(s.get("k")).rejects.toThrow("denied");
  });

  it("refuses keys that could escape the prefix", async () => {
    const { client } = fakeClient();
    const s = new S3Storage({ bucket: "erp", prefix: "a/", client: client as never });
    for (const key of ["../x", "a/../../x", "/abs", ""]) {
      await expect(s.put(key, Buffer.from("x"))).rejects.toThrow("Invalid storage key");
    }
  });
});

describe("S3Storage: verification reads", () => {
  it("heads an object (size, type) and reports a missing one as null", async () => {
    const { client } = fakeClient();
    const s = new S3Storage({ bucket: "erp", client: client as never });
    await s.put("k", Buffer.from("%PDF-1.4 hello"));
    expect(await s.head("k")).toEqual({ size: 14, contentType: "application/pdf" });
    expect(await s.head("missing")).toBeNull();
  });

  it("reads only the first bytes with a Range request", async () => {
    const { client } = fakeClient();
    const s = new S3Storage({ bucket: "erp", client: client as never });
    await s.put("k", Buffer.from("0123456789"));
    expect((await s.readHead("k", 4))?.toString()).toBe("0123");
    expect(await s.readHead("missing", 4)).toBeNull();
  });
});

// Presigning is an offline computation: a real SDK client with throwaway credentials and an R2-style endpoint is enough
// to check exactly what the browser would be given.
describe("S3Storage: presigned URLs (Cloudflare R2 shape)", () => {
  const client = new S3Client({
    region: "auto",
    endpoint: "https://0123456789abcdef.r2.cloudflarestorage.com",
    credentials: { accessKeyId: "AKIATEST", secretAccessKey: "secret" },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const s = new S3Storage({ bucket: "buk-attachments", prefix: "attachments/", client });

  it("signs a PUT for exactly the declared Content-Type, with an expiry and no checksum parameters", async () => {
    const put = await s.presignPut("req1/abc", { contentType: "image/jpeg", expiresIn: 1800 });
    const url = new URL(put.url);
    expect(url.host).toBe("buk-attachments.0123456789abcdef.r2.cloudflarestorage.com");
    expect(url.pathname).toBe("/attachments/req1/abc");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("1800");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("content-type");
    expect([...url.searchParams.keys()].filter((k) => /checksum/i.test(k))).toEqual([]);
    expect(put.headers).toEqual({ "Content-Type": "image/jpeg" });
  });

  it("signs a 5-minute GET that forces the stored type and the download disposition", async () => {
    const get = await s.presignGet("req1/abc", { contentType: "application/pdf", disposition: 'inline; filename="a.pdf"', expiresIn: 300 });
    const url = new URL(get);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("response-content-type")).toBe("application/pdf");
    expect(url.searchParams.get("response-content-disposition")).toBe('inline; filename="a.pdf"');
  });

  it("refuses to presign a key that escapes the prefix", async () => {
    await expect(s.presignPut("../x", { contentType: "image/jpeg", expiresIn: 60 })).rejects.toThrow("Invalid storage key");
  });
});
