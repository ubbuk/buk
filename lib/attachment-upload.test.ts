import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./prisma";
import { storage } from "./storage";
import { signedBuffer } from "./attachment-fixtures";
import { presignAttachments, finalizeAttachments, deleteRequestWithFiles, getAttachmentRef } from "./attachments";
import { readToken, signToken, type UploadedRef } from "./attachment-upload";
import { MAX_ATTACHMENTS_PER_REQUEST } from "./attachment-rules";

// The direct-to-bucket flow end to end against the real database, with the local-disk driver standing in for the bucket
// (the browser's PUT is simulated by storage.put on the issued key).

const P = "vitest-upl-";
const OWNER = `${P}owner`;
const OTHER = `${P}other`;
const DEPT = `${P}dept`;
let counter = 0;

async function newRequest() {
  counter += 1;
  return prisma.materialRequest.create({
    data: { requestNumber: `VITEST-UPL-${Date.now()}-${counter}`, year: 9999, sequence: 900000 + counter, requestedById: OWNER, departmentId: DEPT, status: "DRAFT" as never },
  });
}

/** presign -> "browser PUT" -> the refs the browser would send to finalize */
async function upload(requestId: string, actor: string, name: string, mime: string, bytes: Buffer, thumb?: Buffer): Promise<UploadedRef> {
  const res = await presignAttachments(requestId, actor, [{ fileName: name, mimeType: mime, sizeBytes: bytes.length, thumbSizeBytes: thumb?.length }]);
  if (!res.ok) throw new Error(`presign: ${res.error}`);
  const [p] = res.data;
  await storage.put(p.file.key, bytes);
  if (thumb && p.thumb) await storage.put(p.thumb.key, thumb);
  return { fileName: name, key: p.file.key, token: p.file.token, thumbKey: p.thumb?.key, thumbToken: p.thumb?.token };
}

beforeAll(async () => {
  await prisma.department.upsert({ where: { id: DEPT }, update: {}, create: { id: DEPT, name: "Vitest upload цех", type: "FACTORY" } });
  for (const id of [OWNER, OTHER]) {
    await prisma.user.upsert({ where: { id }, update: {}, create: { id, email: `${id}@test.local`, name: id, role: "EMPLOYEE", departmentId: DEPT, passwordHash: "unused" } });
  }
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: P } } });
  await prisma.materialRequest.deleteMany({ where: { requestedById: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.department.deleteMany({ where: { id: DEPT } });
});

describe("presign", () => {
  it("issues a token-bound PUT target per file and one for the thumbnail", async () => {
    const req = await newRequest();
    const res = await presignAttachments(req.id, OWNER, [{ fileName: "a.jpg", mimeType: "image/jpeg", sizeBytes: 100, thumbSizeBytes: 10 }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [p] = res.data;
    expect(p.file.key.startsWith(`${req.id}/`)).toBe(true);
    expect(p.thumb?.key).toBe(`${p.file.key}.thumb`);
    expect(p.file.headers["Content-Type"]).toBe("image/jpeg");
    expect(readToken(p.file.token)).toMatchObject({ k: p.file.key, m: "image/jpeg", s: 100, u: OWNER });
  });

  it("refuses non-owners, unknown types, HEIC (the browser converts it), empty and oversized files", async () => {
    const req = await newRequest();
    const decl = (over: object) => [{ fileName: "f", mimeType: "application/pdf", sizeBytes: 10, ...over }];
    expect((await presignAttachments(req.id, OTHER, decl({}))).ok).toBe(false);
    const status = async (d: object[]) => {
      const r = await presignAttachments(req.id, OWNER, d as never);
      return r.ok ? 200 : r.status;
    };
    expect(await status(decl({ mimeType: "application/x-msdownload" }))).toBe(400);
    expect(await status(decl({ mimeType: "image/heic", fileName: "IMG.HEIC" }))).toBe(400);
    expect(await status(decl({ sizeBytes: 0 }))).toBe(400);
    expect(await status(decl({ mimeType: "image/jpeg", sizeBytes: 10 * 1024 * 1024 + 1 }))).toBe(400);
    expect(await status(decl({ sizeBytes: 20 * 1024 * 1024 + 1 }))).toBe(400);
    expect(await status(decl({ sizeBytes: 20 * 1024 * 1024 }))).toBe(200); // documents may be 20 MB
    expect(await status(decl({ thumbSizeBytes: 5 }))).toBe(400); // a thumbnail only belongs to an image
  });
});

describe("finalize", () => {
  it("registers verified files with their thumbnail and serves the thumbnail on request", async () => {
    const req = await newRequest();
    const ref = await upload(req.id, OWNER, "photo.jpg", "image/jpeg", signedBuffer("image/jpeg", 500), signedBuffer("image/jpeg", 50));
    const res = await finalizeAttachments(req.id, OWNER, [ref]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const row = await prisma.attachment.findUniqueOrThrow({ where: { id: res.data[0].id } });
    expect(row).toMatchObject({ mimeType: "image/jpeg", sizeBytes: 500, thumbKey: ref.thumbKey, storageKey: ref.key });
    const full = await getAttachmentRef(req.id, row.id);
    const thumb = await getAttachmentRef(req.id, row.id, true);
    expect(full.ok && full.data.key).toBe(ref.key);
    expect(thumb.ok && thumb.data.key).toBe(ref.thumbKey);
  });

  it("takes the size and type from the stored object, not from the browser", async () => {
    const req = await newRequest();
    // declared 500 bytes, but only 300 arrive
    const short = await presignAttachments(req.id, OWNER, [{ fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 500 }]);
    if (!short.ok) throw new Error("presign");
    await storage.put(short.data[0].file.key, signedBuffer("application/pdf", 300));
    const r1 = await finalizeAttachments(req.id, OWNER, [{ fileName: "a.pdf", key: short.data[0].file.key, token: short.data[0].file.token }]);
    expect(r1.ok).toBe(false);
    expect(await storage.head(short.data[0].file.key)).toBeNull(); // the refused object is removed

    // declared as a JPEG, bytes are HTML
    const fake = await upload(req.id, OWNER, "fake.jpg", "image/jpeg", Buffer.from("<html><script>alert(1)</script></html>"));
    const r2 = await finalizeAttachments(req.id, OWNER, [fake]);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toContain("төрөлтэйгээ таарахгүй");
    expect(await storage.head(fake.key)).toBeNull();

    // never uploaded at all
    const ghost = await presignAttachments(req.id, OWNER, [{ fileName: "g.pdf", mimeType: "application/pdf", sizeBytes: 10 }]);
    if (!ghost.ok) throw new Error("presign");
    const r3 = await finalizeAttachments(req.id, OWNER, [{ fileName: "g.pdf", key: ghost.data[0].file.key, token: ghost.data[0].file.token }]);
    expect(r3.ok).toBe(false);
  });

  it("drops an invalid thumbnail but keeps the file", async () => {
    const req = await newRequest();
    const ref = await upload(req.id, OWNER, "p.jpg", "image/jpeg", signedBuffer("image/jpeg", 400), Buffer.from("not a jpeg at all"));
    const res = await finalizeAttachments(req.id, OWNER, [ref]);
    expect(res.ok).toBe(true);
    expect((await prisma.attachment.findFirstOrThrow({ where: { requestId: req.id } })).thumbKey).toBeNull();
    expect(await storage.head(ref.thumbKey!)).toBeNull();
  });

  it("rejects forged, foreign, expired and reused tokens", async () => {
    const req = await newRequest();
    const other = await newRequest();
    const mine = await upload(req.id, OWNER, "a.pdf", "application/pdf", signedBuffer("application/pdf", 64));

    // another user cannot register (or delete) the owner's upload
    expect((await finalizeAttachments(req.id, OTHER, [mine])).ok).toBe(false);
    expect(await storage.head(mine.key)).not.toBeNull();

    // the token is bound to this request's key prefix
    expect((await finalizeAttachments(other.id, OWNER, [mine])).ok).toBe(false);
    expect(await storage.head(mine.key)).not.toBeNull();

    // tampered / expired tokens
    expect((await finalizeAttachments(req.id, OWNER, [{ ...mine, token: `${mine.token.slice(0, -2)}xx` }])).ok).toBe(false);
    const expired = signToken({ k: mine.key, m: "application/pdf", s: 64, u: OWNER, e: Date.now() - 1000 });
    expect((await finalizeAttachments(req.id, OWNER, [{ ...mine, token: expired }])).ok).toBe(false);

    // a real finalize works once; replaying it must not create a second row for the same object
    expect((await finalizeAttachments(req.id, OWNER, [mine])).ok).toBe(true);
    const again = await finalizeAttachments(req.id, OWNER, [mine]);
    expect(again.ok).toBe(false);
    expect(await storage.head(mine.key)).not.toBeNull(); // the registered object survives the refused replay
    expect(await prisma.attachment.count({ where: { requestId: req.id } })).toBe(1);
  });

  it("enforces the per-request cap at finalize and cleans up what it refuses", async () => {
    const req = await newRequest();
    const refs: UploadedRef[] = [];
    for (let i = 0; i < MAX_ATTACHMENTS_PER_REQUEST + 1; i++) refs.push(await upload(req.id, OWNER, `f${i}.pdf`, "application/pdf", signedBuffer("application/pdf", 32)));
    const res = await finalizeAttachments(req.id, OWNER, refs);
    expect(res.ok).toBe(false);
    for (const r of refs) expect(await storage.head(r.key)).toBeNull();
  });
});

describe("deleting a request", () => {
  it("removes its files and thumbnails from storage, not just the rows", async () => {
    const req = await newRequest();
    const ref = await upload(req.id, OWNER, "a.jpg", "image/jpeg", signedBuffer("image/jpeg", 200), signedBuffer("image/jpeg", 20));
    const doc = await upload(req.id, OWNER, "b.pdf", "application/pdf", signedBuffer("application/pdf", 64));
    const fin = await finalizeAttachments(req.id, OWNER, [ref, doc]);
    expect(fin.ok).toBe(true);
    await deleteRequestWithFiles(req.id);
    expect(await prisma.attachment.count({ where: { requestId: req.id } })).toBe(0);
    for (const key of [ref.key, ref.thumbKey!, doc.key]) expect(await storage.head(key)).toBeNull();
  });
});
