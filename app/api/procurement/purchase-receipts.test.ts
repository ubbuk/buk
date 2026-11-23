import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { storage } from "@/lib/storage";
import { signedBuffer } from "@/lib/attachment-fixtures";
import { completeProcurement, recordPurchase } from "@/lib/procurement";
import { finalizeReceipts, getReceiptsOverview, presignReceipts, removeReceipt, returnToProcurement, waiveReceipt } from "@/lib/purchase-receipts";
import { itemsMissingReceipt, compareAmounts } from "@/lib/purchase-receipt-core";
import type { UploadedRef } from "@/lib/attachment-upload";

// Purchase receipts: the Manager attaches proof of purchase, completing needs one per bought row (or a stated reason), the Chief
// Accountant reviews / compares / returns, and everything locks once it leaves procurement. Real database, local-disk storage
// standing in for the bucket (the browser's PUT is simulated by storage.put on the issued key); only the session is replaced.
const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("next-auth", () => ({ getServerSession: async () => session.current }));

import { GET as OVERVIEW } from "../requests/[id]/procurement/receipts/route";
import { GET as FILE, DELETE as REMOVE } from "../requests/[id]/procurement/receipts/[receiptId]/route";
import { POST as COMPLETE } from "../requests/[id]/procurement/complete/route";
import { POST as ACCOUNTING_RETURN } from "../requests/[id]/accounting-return/route";
import { POST as ACCOUNTING } from "../requests/[id]/accounting-record/route";

const P = "prc-";
const DEPT = `${P}dept`;
const roster = {
  req: "EMPLOYEE", // the requester
  other: "EMPLOYEE", // a colleague: sees nothing of this request
  mgr: "MANAGER",
  mgr2: "MANAGER",
  acct: "CHIEF_ACCOUNTANT",
  store: "STOREKEEPER",
} as const;
type Who = keyof typeof roster;
const uid = (w: Who) => `${P}${w}`;
const as = (w: Who | null) => {
  session.current = w ? { user: { id: uid(w), role: roster[w], departmentId: DEPT, name: uid(w), email: `${uid(w)}@t.local` } } : null;
};
const ctx = (id: string, extra: Record<string, string> = {}) => ({ params: Promise.resolve({ id, ...extra }) }) as never;
const post = (body?: unknown) => new Request("http://localhost/x", { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const get = () => new Request("http://localhost/x");

let seq = 0;
interface Built {
  id: string;
  bearing: string;
  washer: string;
}
/** A request waiting in procurement with both lines fully bought (bearing 12 x 1000 = 12 000, washer 6 x 100 = 600). */
async function build(opts: { bought?: boolean } = {}): Promise<Built> {
  seq += 1;
  const approved = ["DEPARTMENT_HEAD", "WAREHOUSE_CHECK", "BRANCH_APPROVAL", "FINANCE_APPROVAL", "EXECUTIVE_APPROVAL"] as const;
  const created = await prisma.materialRequest.create({
    data: {
      requestNumber: `PRC-${Date.now()}-${seq}`,
      year: 9998,
      sequence: 700_000 + seq,
      departmentId: DEPT,
      requestedById: uid("req"),
      status: "PENDING_PROCUREMENT",
      items: {
        create: [
          { lineNo: 1, unit: "ш", requestedQuantity: 12, unitPrice: 900, totalPrice: 10800, manualMaterialName: "prc Bearing" },
          { lineNo: 2, unit: "ш", requestedQuantity: 6, unitPrice: 90, totalPrice: 540, manualMaterialName: "prc Washer" },
        ],
      },
      approvalSteps: {
        create: [
          ...approved.map((type, i) => ({ type, sequence: i + 1, status: "APPROVED" as const, assignedUserId: uid("store") })),
          { type: "MANAGER_PROCUREMENT" as const, sequence: 6, status: "PENDING" as const, assignedUserId: null },
          { type: "ACCOUNTING_RECORD" as const, sequence: 7, status: "PENDING" as const, assignedUserId: uid("acct") },
        ],
      },
    },
    include: { items: { orderBy: { lineNo: "asc" } } },
  });
  const check = await prisma.warehouseCheck.create({ data: { requestId: created.id, checkedById: uid("store") } });
  await prisma.warehouseCheckItem.createMany({
    data: created.items.map((i) => ({ warehouseCheckId: check.id, requestItemId: i.id, availableQuantity: 0, allocatedQuantity: 0, missingQuantity: Number(i.requestedQuantity) })),
  });
  const b = { id: created.id, bearing: created.items[0].id, washer: created.items[1].id };
  if (opts.bought !== false) {
    expect((await recordPurchase(b.id, uid("mgr"), { itemId: b.bearing, quantity: 12, unitPrice: 1000 })).ok).toBe(true);
    expect((await recordPurchase(b.id, uid("mgr"), { itemId: b.washer, quantity: 6, unitPrice: 100 })).ok).toBe(true);
  }
  return b;
}

/** presign -> "browser PUT" -> finalize, as the screens do it. */
async function attach(requestId: string, actor: Who, itemId: string | null, over: { kind?: "WAYBILL" | "INVOICE" | "VAT_RECEIPT" | "CASH_RECEIPT" | "OTHER"; amount?: number | null; bytes?: Buffer; mime?: string; name?: string } = {}) {
  const mime = over.mime ?? "image/jpeg";
  const bytes = over.bytes ?? signedBuffer(mime, 64);
  const name = over.name ?? "padaan.jpg";
  const presigned = await presignReceipts(requestId, uid(actor), itemId, [{ fileName: name, mimeType: mime, sizeBytes: bytes.length }]);
  if (!presigned.ok) return presigned;
  const [p] = presigned.data;
  await storage.put(p.file.key, bytes);
  const ref: UploadedRef = { fileName: name, key: p.file.key, token: p.file.token };
  return finalizeReceipts(requestId, uid(actor), itemId, { kind: over.kind ?? "WAYBILL", supplierName: "Тест ХХК", receiptNumber: "A-1", receiptDate: "2026-11-20", amount: over.amount === undefined ? null : over.amount }, [ref]);
}

async function cleanup() {
  const requests = await prisma.materialRequest.findMany({ where: { requestNumber: { startsWith: "PRC-" } }, select: { id: true } });
  const ids = requests.map((r) => r.id);
  const files = await prisma.purchaseReceipt.findMany({ where: { requestId: { in: ids } }, select: { storageKey: true } });
  for (const f of files) await storage.delete(f.storageKey).catch(() => {});
  await prisma.procurementPurchase.deleteMany({ where: { requestItem: { requestId: { in: ids } } } });
  await prisma.warehouseCheck.deleteMany({ where: { requestId: { in: ids } } });
  await prisma.accountingRecord.deleteMany({ where: { requestId: { in: ids } } });
  await prisma.notification.deleteMany({ where: { userId: { startsWith: P } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { startsWith: P } }, { entityId: { in: ids } }] } });
  await prisma.materialRequest.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.department.deleteMany({ where: { id: DEPT } });
}

beforeAll(async () => {
  await cleanup();
  await prisma.department.create({ data: { id: DEPT, name: "prc цех", type: "FACTORY" } });
  await prisma.user.createMany({ data: (Object.keys(roster) as Who[]).map((w) => ({ id: uid(w), email: `${uid(w)}@test.local`, name: uid(w), passwordHash: "x", role: roster[w] as never, departmentId: w === "mgr" || w === "mgr2" || w === "acct" || w === "store" ? null : DEPT })) });
});
afterAll(cleanup);

describe("coverage and comparison rules (pure)", () => {
  it("a row is covered by its own receipt, a whole-purchase receipt or a reason", () => {
    expect(itemsMissingReceipt({ itemIds: ["a", "b"], receiptItemIds: [], waivedItemIds: [] })).toEqual(["a", "b"]);
    expect(itemsMissingReceipt({ itemIds: ["a", "b"], receiptItemIds: ["a"], waivedItemIds: [] })).toEqual(["b"]);
    expect(itemsMissingReceipt({ itemIds: ["a", "b"], receiptItemIds: ["a"], waivedItemIds: ["b"] })).toEqual([]);
    expect(itemsMissingReceipt({ itemIds: ["a", "b"], receiptItemIds: [null], waivedItemIds: [] })).toEqual([]);
  });

  it("amounts: matching, differing, and incomplete when a receipt has no amount", () => {
    expect(compareAmounts(100, [{ amount: 60 }, { amount: 40 }])).toMatchObject({ matches: true, difference: 0 });
    expect(compareAmounts(100, [{ amount: 90 }])).toMatchObject({ matches: false, difference: -10 });
    expect(compareAmounts(100, [{ amount: 100 }, { amount: null }])).toMatchObject({ matches: false, receiptsWithoutAmount: 1 });
    expect(compareAmounts(100, [])).toMatchObject({ matches: false, receipts: 0 });
  });
});

describe("completing procurement needs a receipt for every bought row", () => {
  it("none attached: stopped with «Баримт хавсаргаагүй» and the rows named; nothing changes", async () => {
    const b = await build();
    as("mgr");
    const r = await COMPLETE(post({}), ctx(b.id));
    expect(r.status).toBe(409);
    const body = await r.json();
    expect(body.code).toBe("RECEIPTS_MISSING");
    expect(body.error).toContain("Баримт хавсаргаагүй");
    expect(body.missing).toEqual(["prc Bearing", "prc Washer"]);
    expect((await prisma.materialRequest.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("PENDING_PROCUREMENT");
    expect(await prisma.purchaseReceiptWaiver.count({ where: { requestId: b.id } })).toBe(0);
  });

  it("a receipt for one row only: the other row is still named", async () => {
    const b = await build();
    expect((await attach(b.id, "mgr", b.bearing, { amount: 12000 })).ok).toBe(true);
    as("mgr");
    const body = await (await COMPLETE(post({}), ctx(b.id))).json();
    expect(body.missing).toEqual(["prc Washer"]);
  });

  it("every row covered by its own receipt: completes", async () => {
    const b = await build();
    expect((await attach(b.id, "mgr", b.bearing)).ok).toBe(true);
    expect((await attach(b.id, "mgr", b.washer, { kind: "CASH_RECEIPT" })).ok).toBe(true);
    as("mgr");
    expect((await COMPLETE(post({}), ctx(b.id))).status).toBe(200);
    expect((await prisma.materialRequest.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("PENDING_ACCOUNTING");
  });

  it("one whole-purchase receipt covers every row", async () => {
    const b = await build();
    expect((await attach(b.id, "mgr", null, { kind: "WAYBILL", amount: 12600 })).ok).toBe(true);
    as("mgr");
    expect((await COMPLETE(post({}), ctx(b.id))).status).toBe(200);
  });

  it("no receipt, with a reason: continues, per-row reason recorded, audited and shown to the accountant", async () => {
    const b = await build();
    as("mgr");
    const tooShort = await COMPLETE(post({ noReceiptReason: "x" }), ctx(b.id));
    expect(tooShort.status).toBe(409);
    expect((await COMPLETE(post({ noReceiptReason: "Зах дээрээс бэлнээр авсан, падаан өгөөгүй" }), ctx(b.id))).status).toBe(200);
    const waivers = await prisma.purchaseReceiptWaiver.findMany({ where: { requestId: b.id } });
    expect(waivers).toHaveLength(2);
    expect(waivers[0].reason).toContain("падаан өгөөгүй");
    expect(await prisma.auditLog.count({ where: { entityId: b.id, action: "PURCHASE_RECEIPT_WAIVE", actorId: uid("mgr") } })).toBe(2);

    as("acct");
    const overview = await (await OVERVIEW(get(), ctx(b.id))).json();
    expect(overview.missingCount).toBe(0); // covered by a reason...
    expect(overview.waivedCount).toBe(2); // ...but flagged
    expect(overview.items.every((i: { waiver: { reason: string } | null }) => i.waiver?.reason)).toBe(true);
  });

  it("a per-row reason given earlier is enough, and a receipt added afterwards replaces it", async () => {
    const b = await build();
    expect((await waiveReceipt(b.id, uid("mgr"), b.bearing, "ab")).ok).toBe(false); // too short
    expect((await waiveReceipt(b.id, uid("mgr"), b.bearing, "Падаан алдагдсан")).ok).toBe(true);
    expect((await waiveReceipt(b.id, uid("mgr2"), b.washer, "Нэхэмжлэх дараа ирнэ")).ok).toBe(true);
    expect((await attach(b.id, "mgr", b.bearing)).ok).toBe(true);
    expect(await prisma.purchaseReceiptWaiver.count({ where: { requestItemId: b.bearing } })).toBe(0);
    expect(await prisma.purchaseReceiptWaiver.count({ where: { requestItemId: b.washer } })).toBe(1);
    as("mgr");
    expect((await COMPLETE(post({}), ctx(b.id))).status).toBe(200);
  });
});

describe("attaching and removing", () => {
  it("stores kind, supplier, number, date, amount and who uploaded it; the file is served back", async () => {
    const b = await build();
    const added = await attach(b.id, "mgr", b.bearing, { kind: "VAT_RECEIPT", amount: 12000.5 });
    expect(added.ok).toBe(true);
    const row = await prisma.purchaseReceipt.findFirstOrThrow({ where: { requestId: b.id } });
    expect(row).toMatchObject({ kind: "VAT_RECEIPT", supplierName: "Тест ХХК", receiptNumber: "A-1", requestItemId: b.bearing, uploadedById: uid("mgr") });
    expect(Number(row.amount)).toBe(12000.5);
    expect(row.receiptDate?.toISOString().slice(0, 10)).toBe("2026-11-20");
    expect(await prisma.auditLog.count({ where: { entityId: b.id, action: "PURCHASE_RECEIPT_ADD", actorId: uid("mgr") } })).toBe(1);

    as("req");
    const served = await FILE(new Request("http://localhost/x"), ctx(b.id, { receiptId: row.id }));
    expect(served.status).toBe(200);
    expect(served.headers.get("Content-Type")).toBe("image/jpeg");
  });

  it("a PDF is accepted; a file whose content is not its type, and a type that is not allowed, are refused", async () => {
    const b = await build();
    expect((await attach(b.id, "mgr", b.bearing, { mime: "application/pdf", name: "nehemjlekh.pdf" })).ok).toBe(true);
    const fake = await attach(b.id, "mgr", b.bearing, { bytes: Buffer.from("this is not a jpeg at all"), name: "fake.jpg" });
    expect(fake.ok).toBe(false);
    const exe = await presignReceipts(b.id, uid("mgr"), b.bearing, [{ fileName: "a.exe", mimeType: "application/x-msdownload", sizeBytes: 10 }]);
    expect(exe).toMatchObject({ ok: false, status: 400 });
    expect(await prisma.purchaseReceipt.count({ where: { requestId: b.id } })).toBe(1);
  });

  it("an invalid amount is refused", async () => {
    const b = await build();
    expect(await attach(b.id, "mgr", b.bearing, { amount: -5 })).toMatchObject({ ok: false, status: 400 });
    expect(await attach(b.id, "mgr", b.bearing, { amount: 10.123 })).toMatchObject({ ok: false, status: 400 });
  });

  it("only an active MANAGER can attach; the requester, the accountant and another role cannot", async () => {
    const b = await build();
    for (const who of ["req", "other", "acct", "store"] as const) {
      expect(await presignReceipts(b.id, uid(who), b.bearing, [{ fileName: "a.jpg", mimeType: "image/jpeg", sizeBytes: 10 }]), who).toMatchObject({ ok: false, status: 403 });
    }
    expect(await presignReceipts(b.id, uid("mgr"), "no-such-item", [{ fileName: "a.jpg", mimeType: "image/jpeg", sizeBytes: 10 }])).toMatchObject({ ok: false, status: 404 });
  });

  it("the uploader can remove a receipt (row and file); another manager cannot", async () => {
    const b = await build();
    await attach(b.id, "mgr", b.bearing);
    const row = await prisma.purchaseReceipt.findFirstOrThrow({ where: { requestId: b.id } });
    expect(await removeReceipt(b.id, row.id, uid("mgr2"))).toMatchObject({ ok: false, status: 403 });
    expect(await storage.get(row.storageKey)).not.toBeNull();
    as("mgr");
    expect((await REMOVE(get(), ctx(b.id, { receiptId: row.id }))).status).toBe(200);
    expect(await prisma.purchaseReceipt.count({ where: { id: row.id } })).toBe(0);
    expect(await storage.get(row.storageKey)).toBeNull();
    expect(await prisma.auditLog.count({ where: { entityId: b.id, action: "PURCHASE_RECEIPT_REMOVE" } })).toBe(1);
  });
});

describe("who can see them", () => {
  it("as visible as the request: the requester, the accountant and managers yes; an unrelated colleague no (list and file)", async () => {
    const b = await build();
    await attach(b.id, "mgr", b.bearing);
    const row = await prisma.purchaseReceipt.findFirstOrThrow({ where: { requestId: b.id } });
    for (const who of ["req", "acct", "mgr", "mgr2", "store"] as const) {
      as(who);
      expect((await OVERVIEW(get(), ctx(b.id))).status, who).toBe(200);
      expect((await FILE(new Request("http://localhost/x"), ctx(b.id, { receiptId: row.id }))).status, who).toBe(200);
    }
    as("other");
    expect((await OVERVIEW(get(), ctx(b.id))).status).toBe(404);
    expect((await FILE(new Request("http://localhost/x"), ctx(b.id, { receiptId: row.id }))).status).toBe(404);
    as(null);
    expect((await OVERVIEW(get(), ctx(b.id))).status).toBe(401);
  });

  it("only the uploader sees the remove button, and only while in procurement", async () => {
    const b = await build();
    await attach(b.id, "mgr", b.bearing);
    expect((await getReceiptsOverview(b.id, { id: uid("mgr"), role: "MANAGER" }))!.items[0].receipts[0].canRemove).toBe(true);
    expect((await getReceiptsOverview(b.id, { id: uid("mgr2"), role: "MANAGER" }))!.items[0].receipts[0].canRemove).toBe(false);
    expect((await getReceiptsOverview(b.id, { id: uid("acct"), role: "CHIEF_ACCOUNTANT" }))!.items[0].receipts[0].canRemove).toBe(false);
  });
});

describe("the accountant's comparison", () => {
  it("receipt amounts are compared with what was bought; missing rows and rows without an amount are visible", async () => {
    const b = await build();
    await attach(b.id, "mgr", b.bearing, { amount: 12000 });
    let o = (await getReceiptsOverview(b.id, { id: uid("acct"), role: "CHIEF_ACCOUNTANT" }))!;
    expect(o.comparison).toMatchObject({ purchased: 12600, receipts: 12000, difference: -600, matches: false });
    expect(o.items.map((i) => i.missing)).toEqual([false, true]);
    expect(o.items[0]).toMatchObject({ purchasedTotal: 12000, receiptAmount: 12000 });
    expect(o.missingCount).toBe(1);

    await attach(b.id, "mgr", b.washer, { amount: 600 });
    o = (await getReceiptsOverview(b.id, { id: uid("acct"), role: "CHIEF_ACCOUNTANT" }))!;
    expect(o.comparison).toMatchObject({ receipts: 12600, difference: 0, matches: true });
    expect(o.missingCount).toBe(0);

    await attach(b.id, "mgr", null, { amount: null });
    o = (await getReceiptsOverview(b.id, { id: uid("acct"), role: "CHIEF_ACCOUNTANT" }))!;
    expect(o.comparison.receiptsWithoutAmount).toBe(1);
    expect(o.comparison.matches).toBe(false); // incomplete: not claimed as matching
  });
});

describe("locked once the accountant has it; the accountant can send it back", () => {
  async function inAccounting() {
    const b = await build();
    await attach(b.id, "mgr", b.bearing, { amount: 12000 });
    await attach(b.id, "mgr", b.washer, { amount: 600 });
    expect((await completeProcurement(b.id, uid("mgr"))).ok).toBe(true);
    return b;
  }

  it("after procurement is completed receipts cannot be added, removed or waived", async () => {
    const b = await inAccounting();
    const row = await prisma.purchaseReceipt.findFirstOrThrow({ where: { requestId: b.id } });
    expect(await presignReceipts(b.id, uid("mgr"), b.bearing, [{ fileName: "a.jpg", mimeType: "image/jpeg", sizeBytes: 10 }])).toMatchObject({ ok: false, status: 409 });
    expect(await removeReceipt(b.id, row.id, uid("mgr"))).toMatchObject({ ok: false, status: 409 });
    expect(await waiveReceipt(b.id, uid("mgr"), b.bearing, "кочэ")).toMatchObject({ ok: false, status: 409 });
    expect((await getReceiptsOverview(b.id, { id: uid("mgr"), role: "MANAGER" }))!.editable).toBe(false);
    expect(await prisma.purchaseReceipt.count({ where: { requestId: b.id } })).toBe(2);
  });

  it("a file uploaded just before the request left procurement is not registered and is cleaned up", async () => {
    const b = await build();
    const bytes = signedBuffer("image/jpeg", 64);
    const presigned = await presignReceipts(b.id, uid("mgr"), b.bearing, [{ fileName: "late.jpg", mimeType: "image/jpeg", sizeBytes: bytes.length }]);
    if (!presigned.ok) throw new Error("presign");
    const [p] = presigned.data;
    await storage.put(p.file.key, bytes);
    await prisma.materialRequest.update({ where: { id: b.id }, data: { status: "PENDING_ACCOUNTING" } });
    const res = await finalizeReceipts(b.id, uid("mgr"), b.bearing, { kind: "OTHER" }, [{ fileName: "late.jpg", key: p.file.key, token: p.file.token }]);
    expect(res).toMatchObject({ ok: false, status: 409 });
    expect(await prisma.purchaseReceipt.count({ where: { requestId: b.id } })).toBe(0);
    expect(await storage.get(p.file.key)).toBeNull();
  });

  it("«Буцаах»: only the accountant of the request, a reason is required, it goes back to the manager who is notified, receipts editable again", async () => {
    const b = await inAccounting();
    as("mgr");
    expect((await ACCOUNTING_RETURN(post({ reason: "Дүн таарахгүй байна" }), ctx(b.id))).status).toBe(403);
    as("acct");
    expect((await ACCOUNTING_RETURN(post({ reason: " " }), ctx(b.id))).status).toBe(400);
    expect((await ACCOUNTING_RETURN(post({ reason: "Падаан бүдэг, дахин зураглана уу" }), ctx(b.id))).status).toBe(200);

    expect((await prisma.materialRequest.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("PENDING_PROCUREMENT");
    const step = await prisma.approvalStep.findFirstOrThrow({ where: { requestId: b.id, type: "MANAGER_PROCUREMENT" } });
    expect(step).toMatchObject({ status: "PENDING", decidedAt: null, decidedById: null });
    const note = await prisma.notification.findFirstOrThrow({ where: { userId: uid("mgr"), relatedRequestId: b.id } });
    expect(note.body).toContain("Падаан бүдэг");
    expect(await prisma.auditLog.count({ where: { entityId: b.id, action: "PROCUREMENT_RETURN", actorId: uid("acct") } })).toBe(1);
    // not twice: it is no longer in accounting
    expect((await ACCOUNTING_RETURN(post({ reason: "дахин" }), ctx(b.id))).status).toBe(409);

    // the manager can fix the receipt and complete again
    const row = await prisma.purchaseReceipt.findFirstOrThrow({ where: { requestId: b.id, requestItemId: b.bearing } });
    expect((await removeReceipt(b.id, row.id, uid("mgr"))).ok).toBe(true);
    expect((await attach(b.id, "mgr", b.bearing, { amount: 12000, name: "retake.jpg" })).ok).toBe(true);
    as("mgr");
    expect((await COMPLETE(post({}), ctx(b.id))).status).toBe(200);
    expect((await prisma.materialRequest.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("PENDING_ACCOUNTING");
  });

  it("another accountant-role user who is not on the step cannot return it", async () => {
    const b = await inAccounting();
    expect(await returnToProcurement(b.id, uid("req"), "хууль бус")).toMatchObject({ ok: false, status: 403 });
    expect((await prisma.materialRequest.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("PENDING_ACCOUNTING");
  });

  it("after the accountant registered it, nothing can be returned or changed", async () => {
    const b = await inAccounting();
    const version = (await prisma.materialRequest.findUniqueOrThrow({ where: { id: b.id } })).version;
    as("acct");
    const done = await ACCOUNTING(post({ ledgerNumber: "L-1", recordDate: "2026-11-24", expectedVersion: version }), ctx(b.id));
    expect(done.status).toBe(200);
    expect((await ACCOUNTING_RETURN(post({ reason: "Хоцорсон" }), ctx(b.id))).status).toBe(409);
    const row = await prisma.purchaseReceipt.findFirstOrThrow({ where: { requestId: b.id } });
    expect(await removeReceipt(b.id, row.id, uid("mgr"))).toMatchObject({ ok: false, status: 409 });
    expect((await getReceiptsOverview(b.id, { id: uid("acct"), role: "CHIEF_ACCOUNTANT" }))!.editable).toBe(false);
  });
});
