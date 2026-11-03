import { describe, expect, it } from "vitest";
import { S3Storage } from "./storage-s3";

// The AWS SDK's network layer is replaced by an in-memory fake `send`; the
// driver's own logic (key prefixing, not-found handling, traversal guard) is real.
function fakeClient() {
  const objects = new Map<string, Buffer>();
  const calls: string[] = [];
  const client = {
    async send(command: { constructor: { name: string }; input: { Bucket: string; Key: string; Body?: Buffer } }) {
      const name = command.constructor.name;
      const { Bucket, Key, Body } = command.input;
      calls.push(`${name} ${Bucket}/${Key}`);
      if (name === "PutObjectCommand") {
        objects.set(`${Bucket}/${Key}`, Body as Buffer);
        return {};
      }
      if (name === "GetObjectCommand") {
        const data = objects.get(`${Bucket}/${Key}`);
        if (!data) throw Object.assign(new Error("missing"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
        return { Body: { transformToByteArray: async () => new Uint8Array(data) } };
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
