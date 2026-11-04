import { describe, expect, it } from "vitest";
import { storage } from "./storage";
import { S3Storage } from "./storage-s3";

// list(prefix) and putNew() on both drivers. The local driver runs against the
// throwaway LOCAL_STORAGE_ROOT that vitest.setup.ts points at a temp directory.

describe("local storage: putNew / list", () => {
  const ns = `list-test-${Date.now()}/`;

  it("putNew writes once and refuses to overwrite", async () => {
    expect(await storage.putNew(`${ns}a.json`, Buffer.from("first"))).toBe(true);
    expect(await storage.putNew(`${ns}a.json`, Buffer.from("second"))).toBe(false);
    expect((await storage.get(`${ns}a.json`))!.toString()).toBe("first");
  });

  it("lists by prefix, recursively, sorted, with sizes", async () => {
    await storage.putNew(`${ns}sub/b.json`, Buffer.from("12345"));
    await storage.putNew(`${ns}c.json`, Buffer.from("xyz"));
    await storage.putNew(`other-${ns}z.json`, Buffer.from("not in prefix"));

    const found = await storage.list(ns);
    expect(found.map((o) => o.key)).toEqual([`${ns}a.json`, `${ns}c.json`, `${ns}sub/b.json`]);
    expect(found.find((o) => o.key.endsWith("sub/b.json"))!.size).toBe(5);
    expect((await storage.list(`${ns}sub/`)).map((o) => o.key)).toEqual([`${ns}sub/b.json`]);
  });

  it("returns an empty list for an unknown prefix", async () => {
    expect(await storage.list("does-not-exist-anywhere/")).toEqual([]);
  });

  it("rejects keys that climb out of the storage root", async () => {
    await expect(storage.putNew("../escape.txt", Buffer.from("x"))).rejects.toThrow();
    await expect(storage.list("../")).rejects.toThrow("Invalid storage key");
  });
});

describe("S3 storage: putNew / list", () => {
  const sent: { name: string; input: Record<string, unknown> }[] = [];

  function fakeClient(handler: (name: string, input: Record<string, unknown>) => unknown) {
    return {
      send: async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
        sent.push({ name: cmd.constructor.name, input: cmd.input });
        return handler(cmd.constructor.name, cmd.input);
      },
    };
  }

  it("putNew sends a conditional write (If-None-Match: *) and maps 412 to false", async () => {
    sent.length = 0;
    const ok = new S3Storage({ bucket: "b", prefix: "attachments/", client: fakeClient(() => ({})) as never });
    expect(await ok.putNew("snapshots/x.json", Buffer.from("x"))).toBe(true);
    expect(sent[0].name).toBe("PutObjectCommand");
    expect(sent[0].input).toMatchObject({ Bucket: "b", Key: "attachments/snapshots/x.json", IfNoneMatch: "*" });

    const exists = new S3Storage({
      bucket: "b",
      client: fakeClient(() => {
        throw Object.assign(new Error("exists"), { name: "PreconditionFailed", $metadata: { httpStatusCode: 412 } });
      }) as never,
    });
    expect(await exists.putNew("k", Buffer.from("x"))).toBe(false);

    const broken = new S3Storage({
      bucket: "b",
      client: fakeClient(() => {
        throw Object.assign(new Error("denied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } });
      }) as never,
    });
    await expect(broken.putNew("k", Buffer.from("x"))).rejects.toThrow("denied");
  });

  it("list follows pagination, strips the configured prefix and sorts keys", async () => {
    sent.length = 0;
    const pages = [
      { Contents: [{ Key: "attachments/snapshots/b.json", Size: 2 }], IsTruncated: true, NextContinuationToken: "t2" },
      { Contents: [{ Key: "attachments/snapshots/a.json", Size: 1 }], IsTruncated: false },
    ];
    const s3 = new S3Storage({ bucket: "b", prefix: "attachments/", client: fakeClient(() => pages.shift()) as never });
    const out = await s3.list("snapshots/");
    expect(out.map((o) => [o.key, o.size])).toEqual([
      ["snapshots/a.json", 1],
      ["snapshots/b.json", 2],
    ]);
    expect(sent.map((c) => c.input.ContinuationToken)).toEqual([undefined, "t2"]);
    expect(sent[0].input).toMatchObject({ Prefix: "attachments/snapshots/" });
    await expect(s3.list("../x/")).rejects.toThrow("Invalid storage prefix");
  });
});
