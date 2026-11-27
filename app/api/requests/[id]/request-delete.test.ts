import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";

// Захиалга устгах (ADMIN, API) + цэвэрлэгээний скриптийн логик, тусдаа тест DB дээр. Агуулахыг mock хийнэ (R2-ийн устгалыг шалгах).
const session = vi.hoisted(() => ({ current: null as unknown }));
const store = vi.hoisted(() => ({ deleted: [] as string[], failKeys: new Set<string>() }));
vi.mock("next-auth", () => ({ getServerSession: async () => session.current }));
vi.mock("@/lib/storage", () => ({
  storage: {
    delete: async (key: string) => {
      if (store.failKeys.has(key)) throw new Error("R2 down");
      store.deleted.push(key);
    },
  },
}));

import { DELETE } from "./route";
import { applyCleanup, parseBeforeDate, planCleanup } from "@/lib/request-delete";
import { formatPlan, parseArgs } from "@/scripts/cleanup-test-orders";

const TAG = Date.now().toString(36);
const P = `rdel-${TAG}-`;
const ADMIN = `${P}admin`;
const OTHER = `${P}boss`;
const OWNER = `${P}owner`;
const PIN = "4821";
let DEPT = "";
let n = 0;
let ipN = 0;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const call = (id: string, body: unknown) =>
  DELETE(new Request("http://localhost/x", { method: "DELETE", headers: { "Content-Type": "application/json", "x-forwarded-for": `10.77.0.${++ipN % 250}` }, body: JSON.stringify(body) }), ctx(id));
const as = (id: string, role: string) => (session.current = { user: { id, role, name: id, email: `${id}@t.local`, departmentId: null } });

/** Бүх хамаарлыг бүтээнэ: мөр, алхам+түүх, агуулахын шалгалт, олголт, худалдан авалт, баримт, шийдвэр, мэдэгдэл, хавсралт. */
async function mkRequest(opts: { status?: "PENDING_ACCOUNTING" | "ACCOUNTING_COMPLETED" | "CANCELLED"; accounting?: boolean; createdAt?: Date } = {}) {
  const k = ++n;
  const r = await prisma.materialRequest.create({
    data: { requestNumber: `RDEL-${TAG}-${k}`, year: 2097, sequence: 800_000 + k, departmentId: DEPT, requestedById: OWNER, status: opts.status ?? "PENDING_ACCOUNTING", createdAt: opts.createdAt },
  });
  const item = await prisma.materialRequestItem.create({ data: { requestId: r.id, lineNo: 1, manualMaterialName: "тест", unit: "ш", requestedQuantity: 10, unitPrice: 1000, totalPrice: 10000 } });
  await prisma.materialRequestItem.create({ data: { requestId: r.id, lineNo: 2, manualMaterialName: "тест2", unit: "ш", requestedQuantity: 2, unitPrice: 500, totalPrice: 1000 } });
  const step = await prisma.approvalStep.create({ data: { requestId: r.id, type: "DEPARTMENT_HEAD", sequence: 1, status: "APPROVED", assignedUserId: OTHER, decidedById: OTHER } });
  await prisma.approvalAction.create({ data: { approvalStepId: step.id, actorId: OTHER, action: "APPROVE" } });
  const wc = await prisma.warehouseCheck.create({ data: { requestId: r.id, checkedById: OTHER } });
  await prisma.warehouseCheckItem.create({ data: { warehouseCheckId: wc.id, requestItemId: item.id, availableQuantity: 5, allocatedQuantity: 5, missingQuantity: 5 } });
  const wh = await prisma.warehouse.create({ data: { name: `${P}wh${k}` } });
  const resv = await prisma.stockReservation.create({ data: { requestItemId: item.id, warehouseId: wh.id, quantity: 5, status: "ISSUED" } });
  await prisma.stockIssue.create({ data: { reservationId: resv.id, issuedById: OTHER, quantity: 5 } });
  await prisma.procurementPurchase.create({ data: { requestItemId: item.id, quantity: 5, unitPrice: 1000, purchasedById: OTHER } });
  await prisma.purchaseReceipt.create({ data: { requestId: r.id, requestItemId: item.id, kind: "INVOICE", fileName: "a.pdf", storageKey: `${P}${k}/receipt.pdf`, thumbKey: `${P}${k}/receipt-thumb.jpg`, mimeType: "application/pdf", sizeBytes: 10, uploadedById: OTHER } });
  await prisma.attachment.create({ data: { requestId: r.id, fileName: "b.png", storageKey: `${P}${k}/b.png`, thumbKey: `${P}${k}/b-thumb.jpg`, mimeType: "image/png", sizeBytes: 10, uploadedById: OWNER } });
  await prisma.attachment.create({ data: { requestId: r.id, fileName: "c.png", storageKey: `${P}${k}/c.png`, mimeType: "image/png", sizeBytes: 10, uploadedById: OWNER } });
  await prisma.executiveApprovalDecision.create({ data: { requestId: r.id, sequence: 1, kind: "INITIAL_FULL", decidedById: OTHER, requiredTotal: 10, approvedTotalAfter: 10 } });
  await prisma.notification.create({ data: { userId: OTHER, type: "GENERIC", title: "t", body: "b", relatedRequestId: r.id } });
  if (opts.accounting) await prisma.accountingRecord.create({ data: { requestId: r.id, ledgerNumber: "L-1", recordDate: new Date(), recordedById: OTHER } });
  return { id: r.id, number: r.requestNumber, k };
}
const exists = (id: string) => prisma.materialRequest.findUnique({ where: { id } });
const leftovers = async (id: string) => ({
  items: await prisma.materialRequestItem.count({ where: { requestId: id } }),
  steps: await prisma.approvalStep.count({ where: { requestId: id } }),
  actions: await prisma.approvalAction.count({ where: { approvalStep: { requestId: id } } }),
  notes: await prisma.notification.count({ where: { relatedRequestId: id } }),
  att: await prisma.attachment.count({ where: { requestId: id } }),
  rec: await prisma.purchaseReceipt.count({ where: { requestId: id } }),
  wc: await prisma.warehouseCheck.count({ where: { requestId: id } }),
  acc: await prisma.accountingRecord.count({ where: { requestId: id } }),
  purchases: await prisma.procurementPurchase.count({ where: { requestItem: { requestId: id } } }),
  exec: await prisma.executiveApprovalDecision.count({ where: { requestId: id } }),
});

beforeAll(async () => {
  const hash = bcrypt.hashSync("x", 4);
  for (const [id, role] of [
    [ADMIN, "ADMIN"],
    [OTHER, "BOSS"],
    [OWNER, "EMPLOYEE"],
  ] as const) {
    await prisma.user.create({ data: { id, email: `${id}@t.local`, name: `${P}${role}`, role, passwordHash: hash } });
  }
  await prisma.approvalPinCredential.create({ data: { userId: ADMIN, pinHash: bcrypt.hashSync(PIN, 4) } });
  await prisma.approvalPinCredential.create({ data: { userId: OTHER, pinHash: bcrypt.hashSync(PIN, 4) } });
  DEPT = (await prisma.department.create({ data: { name: `${P}dept`, type: "OFFICE" } })).id;
});
beforeEach(() => {
  store.deleted.length = 0;
  store.failKeys.clear();
  as(ADMIN, "ADMIN");
});
afterAll(async () => {
  const left = await prisma.materialRequest.findMany({ where: { requestNumber: { startsWith: `RDEL-${TAG}` } }, select: { id: true } });
  await applyCleanup(await planCleanup({ ids: left.map((l) => l.id) }, { includeFinance: true }), ADMIN, { includeFinance: true });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: [ADMIN, OTHER] } } });
  await prisma.notification.deleteMany({ where: { userId: OTHER } });
  await prisma.warehouse.deleteMany({ where: { name: { startsWith: P } } });
  await prisma.approvalPinCredential.deleteMany({ where: { userId: { in: [ADMIN, OTHER] } } });
  await prisma.department.deleteMany({ where: { name: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { id: { in: [ADMIN, OTHER, OWNER] } } });
});

describe("DELETE /api/requests/[id]", () => {
  it("нэвтрээгүй: 401, ADMIN биш: 403 (захиалга хэвээр)", async () => {
    const r = await mkRequest();
    session.current = null;
    expect((await call(r.id, { confirmName: r.number, pin: PIN })).status).toBe(401);
    for (const [id, role] of [
      [OTHER, "BOSS"],
      [OWNER, "EMPLOYEE"],
      [OTHER, "CHIEF_ACCOUNTANT"],
      [OTHER, "MANAGER"],
    ] as const) {
      as(id, role);
      expect((await call(r.id, { confirmName: r.number, pin: PIN })).status).toBe(403);
    }
    expect(await exists(r.id)).not.toBeNull();
    expect(store.deleted).toEqual([]);
  });

  it("нэр буруу: устгахгүй, PIN-ий оролдлого үрэхгүй", async () => {
    const r = await mkRequest();
    const res = await call(r.id, { confirmName: r.number + "x", pin: "0000" });
    expect(res.status).toBe(400);
    expect(await exists(r.id)).not.toBeNull();
    expect((await prisma.approvalPinCredential.findUnique({ where: { userId: ADMIN } }))!.failedAttempts).toBe(0);
    expect((await call(r.id, { confirmName: "", pin: PIN })).status).toBe(400);
    expect((await call(r.id, {})).status).toBe(400);
    expect(await exists(r.id)).not.toBeNull();
  });

  it("PIN буруу: 401, устгахгүй, файл хэвээр", async () => {
    const r = await mkRequest();
    const res = await call(r.id, { confirmName: r.number, pin: "9999" });
    expect(res.status).toBe(401);
    expect(await exists(r.id)).not.toBeNull();
    expect(store.deleted).toEqual([]);
    await prisma.approvalPinCredential.update({ where: { userId: ADMIN }, data: { failedAttempts: 0 } });
  });

  it("олдохгүй захиалга: 404", async () => {
    expect((await call("nope", { confirmName: "x", pin: PIN })).status).toBe(404);
  });

  it("санхүүд бүртгэгдсэн (нягтлангийн бүртгэлтэй): 409 + мессеж, юу ч устахгүй", async () => {
    const r = await mkRequest({ accounting: true });
    const res = await call(r.id, { confirmName: r.number, pin: PIN });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Санхүүд бүртгэгдсэн тул устгах боломжгүй, цуцлана уу");
    expect(await exists(r.id)).not.toBeNull();
    expect((await leftovers(r.id)).acc).toBe(1);
    expect(store.deleted).toEqual([]);
  });

  it("төлөв ACCOUNTING_COMPLETED бол мөн 409", async () => {
    const r = await mkRequest({ status: "ACCOUNTING_COMPLETED" });
    expect((await call(r.id, { confirmName: r.number, pin: PIN })).status).toBe(409);
    expect(await exists(r.id)).not.toBeNull();
  });

  it("ADMIN + зөв нэр + зөв PIN: бүх хамаарал, файл (thumb-тэй), мэдэгдэл устна; аудит үлдэнэ", async () => {
    const r = await mkRequest();
    const other = await mkRequest(); // бусад захиалгад хүрэхгүй
    const res = await call(r.id, { confirmName: ` ${r.number} `, pin: PIN });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ deleted: true, requestNumber: r.number, storageFailed: 0 });
    expect(await exists(r.id)).toBeNull();
    expect(await leftovers(r.id)).toEqual({ items: 0, steps: 0, actions: 0, notes: 0, att: 0, rec: 0, wc: 0, acc: 0, purchases: 0, exec: 0 });
    expect([...store.deleted].sort()).toEqual(
      [`${P}${r.k}/b-thumb.jpg`, `${P}${r.k}/b.png`, `${P}${r.k}/c.png`, `${P}${r.k}/receipt-thumb.jpg`, `${P}${r.k}/receipt.pdf`].sort()
    );
    expect(await exists(other.id)).not.toBeNull();
    expect((await leftovers(other.id)).items).toBe(2);

    const audit = await prisma.auditLog.findFirst({ where: { entityType: "MaterialRequest", entityId: r.id, action: "REQUEST_DELETE" } });
    expect(audit).toMatchObject({ actorId: ADMIN });
    expect(JSON.parse(audit!.beforeJson!)).toMatchObject({ requestNumber: r.number, totalAmount: 11000, requesterId: OWNER, requesterName: `${P}EMPLOYEE`, files: 5, via: "api" });
    expect(audit!.createdAt).toBeInstanceOf(Date);
    // хэрэглэгч, хэлтэс хэвээр
    expect(await prisma.user.count({ where: { id: { in: [ADMIN, OTHER, OWNER] } } })).toBe(3);
    expect(await prisma.department.findUnique({ where: { id: DEPT } })).not.toBeNull();
  });

  it("R2 устгал амжилтгүй бол DB-ийн устгал хүчинтэй, түлхүүр аудитад тэмдэглэгдэнэ", async () => {
    const r = await mkRequest();
    store.failKeys.add(`${P}${r.k}/c.png`);
    const res = await call(r.id, { confirmName: r.number, pin: PIN });
    expect(res.status).toBe(200);
    expect((await res.json()).storageFailed).toBe(1);
    expect(await exists(r.id)).toBeNull();
    const audit = await prisma.auditLog.findFirst({ where: { entityId: r.id, action: "REQUEST_DELETE" } });
    expect(JSON.parse(audit!.afterJson!)).toEqual({ storageDeleteFailed: [`${P}${r.k}/c.png`] });
  });
});

describe("cleanup:test-orders", () => {
  // 2020-2021: бусад тестийн захиалгыг --before-д оруулахгүй (хурдан, тусгаарлагдсан)
  const old = new Date("2020-06-01T04:00:00Z");
  const fresh = new Date("2021-06-01T04:00:00Z");

  it("аргумент: --before/--ids заавал, хоёул зэрэг болохгүй, анхдагч dry-run", () => {
    expect(parseArgs(["--before", "2026-11-28"])).toEqual({ before: "2026-11-28", apply: false, includeFinance: false });
    expect(parseArgs(["--ids", "a, b", "--apply", "--include-finance"])).toMatchObject({ ids: ["a", "b"], apply: true, includeFinance: true });
    expect(() => parseArgs([])).toThrow();
    expect(() => parseArgs(["--apply"])).toThrow();
    expect(() => parseArgs(["--before", "2026-11-28", "--ids", "a"])).toThrow();
    expect(() => parseArgs(["--wat"])).toThrow();
    expect(() => parseBeforeDate("2026/11/28")).toThrow();
    expect(parseBeforeDate("2026-11-28").toISOString()).toBe("2026-11-27T16:00:00.000Z"); // Улаанбаатарын 00:00
  });

  it("dry-run: юу устахыг тоолно, ЮУ Ч УСТГАХГҮЙ", async () => {
    const a = await mkRequest({ createdAt: old });
    const b = await mkRequest({ createdAt: old, accounting: true });
    const c = await mkRequest({ createdAt: fresh });
    const plan = await planCleanup({ ids: [a.number, b.number, c.number, "NOPE"] });
    expect(plan.targets.map((t) => t.requestNumber).sort()).toEqual([a.number, c.number].sort());
    expect(plan.skippedFinance.map((t) => t.requestNumber)).toEqual([b.number]);
    expect(plan.notFound).toEqual(["NOPE"]);
    expect(plan.totals).toMatchObject({ requests: 2, items: 4, approvalActions: 2, notifications: 2, attachmentRows: 6, storageObjects: 10, stockIssues: 2 });
    const text = formatPlan(plan, false);
    expect(text).toContain("DRY-RUN");
    expect(text).toContain("--apply");
    expect(text).toContain(`АЛГАСАВ (санхүүд бүртгэгдсэн): ${b.number}`);
    // dry-run юу ч устгаагүй
    for (const r of [a, b, c]) expect(await exists(r.id)).not.toBeNull();
    expect(store.deleted).toEqual([]);
    expect(await prisma.auditLog.count({ where: { action: "REQUEST_DELETE", actorId: ADMIN, entityId: { in: [a.id, b.id, c.id] } } })).toBe(0);
  });

  it("--before: зөвхөн тухайн өдрөөс өмнөх; --apply: устгана, санхүүд бүртгэгдсэнийг алгасна, аудит бичнэ", async () => {
    const a = await mkRequest({ createdAt: old });
    const b = await mkRequest({ createdAt: old, accounting: true });
    const c = await mkRequest({ createdAt: fresh });
    const plan = await planCleanup({ before: parseBeforeDate("2021-01-01") }, {});
    const mine = (t: { requestNumber: string }) => t.requestNumber.startsWith(`RDEL-${TAG}`);
    // бусад тестийн өгөгдлийг хөндөхгүйн тулд зөвхөн өөрийн захиалгаар хязгаарлаж гүйцэтгэнэ
    const scoped = { ...plan, targets: plan.targets.filter(mine) };
    expect(scoped.targets.map((t) => t.requestNumber)).toContain(a.number);
    expect(scoped.targets.map((t) => t.requestNumber)).not.toContain(c.number);
    expect(plan.skippedFinance.map((t) => t.requestNumber)).toContain(b.number);
    const r = await applyCleanup(scoped, ADMIN);
    expect(r.failed).toEqual([]);
    expect(r.deleted).toContain(a.number);
    expect(await exists(a.id)).toBeNull();
    expect(await exists(b.id)).not.toBeNull();
    expect(await exists(c.id)).not.toBeNull();
    expect(store.deleted).toContain(`${P}${a.k}/b-thumb.jpg`);
    const audit = await prisma.auditLog.findFirst({ where: { entityId: a.id, action: "REQUEST_DELETE" } });
    expect(audit).toMatchObject({ actorId: ADMIN, ipAddress: "cleanup-script" });
    expect(JSON.parse(audit!.beforeJson!).via).toBe("cleanup-script");
  });

  it("--include-finance: санхүүд бүртгэгдсэнийг ч устгана (бүртгэлтэй нь хамт)", async () => {
    const b = await mkRequest({ createdAt: old, accounting: true });
    const plan = await planCleanup({ ids: [b.id] }, { includeFinance: true });
    expect(plan.targets).toHaveLength(1);
    expect(plan.skippedFinance).toHaveLength(0);
    const r = await applyCleanup(plan, ADMIN, { includeFinance: true });
    expect(r.deleted).toEqual([b.number]);
    expect(await exists(b.id)).toBeNull();
    expect((await leftovers(b.id)).acc).toBe(0);
  });

  it("applyCleanup includeFinance-гүйгээр санхүүд бүртгэгдсэнд хүрэхгүй (төлөвлөгөөг гараар хуурсан ч)", async () => {
    const b = await mkRequest({ createdAt: old, accounting: true });
    const plan = await planCleanup({ ids: [b.id] }, { includeFinance: true });
    const r = await applyCleanup(plan, ADMIN, {});
    expect(r.deleted).toEqual([]);
    expect(r.failed[0].error).toContain("Санхүүд бүртгэгдсэн");
    expect(await exists(b.id)).not.toBeNull();
  });
});
