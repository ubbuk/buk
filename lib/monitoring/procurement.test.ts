import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { eventBus } from "@/lib/events";
import { classifyProcurement, completeProcurement, recordPurchase, voidPurchase } from "@/lib/procurement";
import { executeHandover } from "@/lib/procurement-handover";
import { recordAccountingEntry } from "@/lib/workflow";
import { getProcurementList, getProcurementOverview, getProcurementRequestDetail, type ProcurementListOptions } from "./procurement";
import { resolveRange } from "./time";

// Procurement monitoring against the isolated test database with real rows (no mocked data layer).
// The shared test database may contain requests from other suites, so counters are asserted as
// DELTAS against a baseline taken before the test builds anything, and lists are isolated by a
// per-run request-number tag.
const TAG = Date.now().toString(36);
const P = "pm-";
const NUM = `PM-${TAG}`;
const ASOF = new Date("2026-11-03T10:00:00Z");
const hAgo = (h: number) => new Date(ASOF.getTime() - h * 3600_000);
const RANGE = resolveRange("all", ASOF);
const ids = { dept: `${P}dept-${TAG}`, mgrA: `${P}mgr-a`, mgrB: `${P}mgr-b`, mgrA2: `${P}mgr-a2`, emp: `${P}emp`, acct: `${P}acct`, store: `${P}store`, admin: `${P}admin` };
const POSITIONS = ["DOMESTIC_PROCUREMENT_MANAGER", "INTERNATIONAL_PROCUREMENT_MANAGER"] as const;
let previouslyActive: { id: string }[] = [];
let counter = 0;

async function wipe() {
  const mine = { requestNumber: { startsWith: "PM-" } };
  await prisma.procurementPurchase.deleteMany({ where: { requestItem: { request: mine } } });
  await prisma.warehouseCheck.deleteMany({ where: { request: mine } });
  await prisma.accountingRecord.deleteMany({ where: { request: mine } });
  await prisma.notification.deleteMany({ where: { userId: { startsWith: P } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: P } } });
  await prisma.materialRequest.deleteMany({ where: mine });
}
async function cleanup() {
  await wipe();
  await prisma.approvalRoleAssignment.deleteMany({ where: { userId: { startsWith: P } } });
  await prisma.user.updateMany({ where: { id: { startsWith: P } }, data: { departmentId: null } });
  await prisma.department.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
}
async function configure(domestic: string | null, international: string | null) {
  await prisma.approvalRoleAssignment.updateMany({ where: { role: { in: [...POSITIONS] }, isActive: true }, data: { isActive: false, endedAt: new Date() } });
  if (domestic) await prisma.approvalRoleAssignment.create({ data: { role: "DOMESTIC_PROCUREMENT_MANAGER", userId: domestic } });
  if (international) await prisma.approvalRoleAssignment.create({ data: { role: "INTERNATIONAL_PROCUREMENT_MANAGER", userId: international } });
}

beforeAll(async () => {
  await cleanup();
  previouslyActive = await prisma.approvalRoleAssignment.findMany({ where: { isActive: true, role: { in: [...POSITIONS] } }, select: { id: true } });
  await prisma.approvalRoleAssignment.updateMany({ where: { id: { in: previouslyActive.map((r) => r.id) } }, data: { isActive: false, endedAt: new Date() } });
  await prisma.department.create({ data: { id: ids.dept, name: `PM${TAG} цех`, type: "FACTORY" } });
  const users = [[ids.mgrA, "MANAGER"], [ids.mgrB, "MANAGER"], [ids.mgrA2, "MANAGER"], [ids.emp, "EMPLOYEE"], [ids.acct, "CHIEF_ACCOUNTANT"], [ids.store, "STOREKEEPER"], [ids.admin, "ADMIN"]] as const;
  for (const [id, role] of users) await prisma.user.create({ data: { id, email: `${id}@test.local`, name: id, role, passwordHash: "x", departmentId: id === ids.emp ? ids.dept : null } });
});
beforeEach(async () => {
  await wipe();
  await configure(ids.mgrA, ids.mgrB);
});
afterAll(async () => {
  await cleanup();
  await prisma.approvalRoleAssignment.updateMany({ where: { id: { in: previouslyActive.map((r) => r.id) } }, data: { isActive: true, endedAt: null } });
});

type K = "cement" | "bearing" | "nozzle" | "washer" | "bolt";
interface Built {
  requestId: string;
  number: string;
  item: Record<K, string>;
}
// cement 20 кг, bearing 12 ш, nozzle 4 ш to buy; washer 6 ш fully issued from stock; bolt 10 ш with 4 issued (6 to buy). Estimated price 100 each.
const SPEC: Record<K, { requested: number; issued: number; unit: string }> = {
  cement: { requested: 20, issued: 0, unit: "кг" },
  bearing: { requested: 12, issued: 0, unit: "ш" },
  nozzle: { requested: 4, issued: 0, unit: "ш" },
  washer: { requested: 6, issued: 6, unit: "ш" },
  bolt: { requested: 10, issued: 4, unit: "ш" },
};
const KEYS = Object.keys(SPEC) as K[];

interface BuildOptions {
  /** CEO approval time: when the request entered procurement (null = unknown) */
  entered?: Date | null;
  /** classification: international item keys, or false for "not classified yet" */
  classify?: K[] | false;
  classifiedAt?: Date;
  assignedAt?: Date;
  status?: "PENDING_PROCUREMENT" | "PENDING_ACCOUNTING" | "ACCOUNTING_COMPLETED";
  manager?: "pending" | "approved";
  noProcurementStep?: boolean;
  noPrices?: boolean;
}

async function build(o: BuildOptions = {}): Promise<Built> {
  counter += 1;
  const entered = o.entered === undefined ? hAgo(10) : o.entered;
  const types = ["DEPARTMENT_HEAD", "WAREHOUSE_CHECK", "BRANCH_APPROVAL", "FINANCE_APPROVAL", "EXECUTIVE_APPROVAL"] as const;
  const created = await prisma.materialRequest.create({
    data: {
      requestNumber: `${NUM}-${counter}`,
      year: 9999,
      sequence: counter,
      departmentId: ids.dept,
      requestedById: ids.emp,
      status: o.status ?? "PENDING_PROCUREMENT",
      version: 5,
      items: {
        create: KEYS.map((k, i) => ({
          lineNo: i + 1,
          unit: SPEC[k].unit,
          requestedQuantity: SPEC[k].requested,
          unitPrice: o.noPrices ? null : 100,
          totalPrice: o.noPrices ? null : SPEC[k].requested * 100,
          manualMaterialName: `PM${TAG} ${k}`,
        })),
      },
      approvalSteps: {
        create: [
          ...types.map((type, i) => ({
            type,
            sequence: i + 1,
            status: "APPROVED" as const,
            assignedUserId: ids.store,
            decidedAt: entered ? new Date(entered.getTime() - (types.length - i) * 60_000) : null,
          })),
          // the CEO step carries the entry time
          ...(o.noProcurementStep
            ? []
            : [{ type: "MANAGER_PROCUREMENT" as const, sequence: 6, status: o.manager === "approved" ? ("APPROVED" as const) : ("PENDING" as const), assignedUserId: null, decidedAt: o.manager === "approved" ? hAgo(1) : null }]),
          { type: "ACCOUNTING_RECORD" as const, sequence: 7, status: "PENDING" as const, assignedUserId: ids.acct },
        ],
      },
    },
    include: { items: { orderBy: { lineNo: "asc" } } },
  });
  if (entered) await prisma.approvalStep.updateMany({ where: { requestId: created.id, type: "EXECUTIVE_APPROVAL" }, data: { decidedAt: entered } });
  const item = {} as Record<K, string>;
  const check = await prisma.warehouseCheck.create({ data: { requestId: created.id, checkedById: ids.store } });
  for (const [i, k] of KEYS.entries()) {
    item[k] = created.items[i].id;
    await prisma.warehouseCheckItem.create({
      data: { warehouseCheckId: check.id, requestItemId: item[k], availableQuantity: SPEC[k].issued, allocatedQuantity: SPEC[k].issued, missingQuantity: SPEC[k].requested - SPEC[k].issued },
    });
  }
  if (o.classify !== undefined && o.classify !== false) {
    await prisma.procurementClassification.create({ data: { requestId: created.id, confirmedById: ids.mgrB, confirmedAt: o.classifiedAt ?? hAgo(6) } });
    const toBuy = KEYS.filter((k) => SPEC[k].requested - SPEC[k].issued > 0);
    await prisma.procurementItemAssignment.createMany({
      data: toBuy.map((k) => ({
        requestItemId: item[k],
        kind: (o.classify as K[]).includes(k) ? ("INTERNATIONAL" as const) : ("DOMESTIC" as const),
        assignedManagerId: (o.classify as K[]).includes(k) ? ids.mgrB : ids.mgrA,
        assignedAt: o.assignedAt ?? hAgo(8),
      })),
    });
  }
  return { requestId: created.id, number: created.requestNumber, item };
}

/** Domestic: cement + bolt. International: bearing + nozzle. */
const classified = (o: BuildOptions = {}) => build({ classify: ["bearing", "nozzle"], ...o });

async function buyRow(b: Built, k: K, quantity: number, unitPrice: number, at: Date, extra: { voidedAt?: Date; replacesId?: string; by?: string } = {}) {
  return prisma.procurementPurchase.create({
    data: {
      requestItemId: b.item[k],
      quantity,
      unitPrice,
      purchasedById: extra.by ?? ids.mgrA,
      purchasedAt: at,
      replacesId: extra.replacesId,
      ...(extra.voidedAt ? { voidedAt: extra.voidedAt, voidedById: ids.mgrA, voidReason: "Буруу бүртгэсэн" } : {}),
    },
  });
}

const overview = (thresholdHours = 72, range = RANGE, asOf = ASOF) => getProcurementOverview(range, asOf, thresholdHours);
const listOpts = (over: Partial<ProcurementListOptions> = {}): ProcurementListOptions => ({
  scope: "active", filter: "all", q: NUM, page: 1, pageSize: 100, thresholdHours: 72, range: RANGE, ...over,
});
const rowsOf = async (over: Partial<ProcurementListOptions> = {}, asOf = ASOF) => (await getProcurementList(asOf, listOpts(over))).rows;
const rowFor = async (b: Built, over: Partial<ProcurementListOptions> = {}, asOf = ASOF) => (await rowsOf(over, asOf)).find((r) => r.requestId === b.requestId)!;

describe("request, item and quantity counts", () => {
  it("counts requests and items separately and counts a shared request once per track", async () => {
    const before = await overview();
    await classified(); // shared: domestic cement + bolt, international bearing + nozzle
    await classified({ classify: [] }); // domestic only
    const after = await overview();
    expect(after.requests.awaitingProcurement - before.requests.awaitingProcurement).toBe(2); // 2 requests, not 4+ items
    expect(after.domestic.requests - before.domestic.requests).toBe(2);
    expect(after.items.domesticOutstanding - before.items.domesticOutstanding).toBe(2 + 4); // cement+bolt, then cement+bolt+bearing+nozzle
    expect(after.international.requests - before.international.requests).toBe(1);
    expect(after.items.internationalOutstanding - before.items.internationalOutstanding).toBe(2);
  });

  it("reports remaining quantities per unit and never merges kilograms with pieces", async () => {
    const before = await overview();
    await classified({ classify: ["bearing", "nozzle"] });
    const after = await overview();
    const of = (o: typeof after, track: "domestic" | "international", unit: string) => o[track].quantities.find((q) => q.unit === unit)?.quantity ?? 0;
    expect(of(after, "domestic", "кг") - of(before, "domestic", "кг")).toBe(20);
    expect(of(after, "domestic", "ш") - of(before, "domestic", "ш")).toBe(6);
    expect(of(after, "international", "ш") - of(before, "international", "ш")).toBe(16);
    expect(of(after, "international", "кг") - of(before, "international", "кг")).toBe(0);
  });

  it("excludes warehouse-fulfilled quantities from what has to be bought", async () => {
    const before = await overview();
    const b = await classified();
    const row = await rowFor(b);
    const washer = row.items.find((i) => i.itemId === b.item.washer)!;
    expect(washer).toMatchObject({ required: 0, warehouseIssued: 6, status: "NOT_REQUIRED", outstanding: 0, kind: null });
    expect(row.items.find((i) => i.itemId === b.item.bolt)).toMatchObject({ requested: 10, warehouseIssued: 4, required: 6, outstanding: 6 });
    expect(row.requiredItems).toBe(4); // washer is not a purchase item
    expect((await overview()).items.warehouseFulfilled - before.items.warehouseFulfilled).toBe(1);
  });
});

describe("classification queue", () => {
  it("counts unclassified requests as awaiting classification, not as domestic or international work", async () => {
    const before = await overview();
    const b = await build({ classify: false });
    const after = await overview();
    expect(after.requests.awaitingClassification - before.requests.awaitingClassification).toBe(1);
    expect(after.items.unassignedOutstanding - before.items.unassignedOutstanding).toBe(4);
    expect(after.items.domesticOutstanding).toBe(before.items.domesticOutstanding);
    expect(after.items.internationalOutstanding).toBe(before.items.internationalOutstanding);
    expect((await rowFor(b)).stage).toBe("AWAITING_CLASSIFICATION");
    expect((await rowsOf({ filter: "classification" })).map((r) => r.requestId)).toEqual([b.requestId]);
  });

  it("does not invent a classification queue when no managers are configured (legacy mode)", async () => {
    await configure(null, null);
    const before = await overview();
    const b = await build({ classify: false });
    const after = await overview();
    expect(after.mode).toBe("LEGACY");
    expect(after.requests.awaitingClassification).toBe(before.requests.awaitingClassification);
    expect((await rowFor(b)).stage).toBe("IN_PROCUREMENT");
  });
});

describe("partial, voided and corrected purchases", () => {
  it("derives partial purchasing, value-weighted completion and cost from active purchases", async () => {
    const before = await overview();
    const b = await classified();
    await buyRow(b, "cement", 5, 123.45, hAgo(3));
    await buyRow(b, "bolt", 6, 10, hAgo(2));
    const row = await rowFor(b);
    expect(row.stage).toBe("IN_PROCUREMENT"); // partial is a derived flag, not a stage
    expect(row.partiallyPurchased).toBe(true);
    expect(row.partialItems).toBe(1);
    expect(row.completeItems).toBe(1);
    expect(row.actualCost).toBeCloseTo(5 * 123.45 + 60, 2);
    expect(row.items.find((i) => i.itemId === b.item.cement)).toMatchObject({ purchased: 5, outstanding: 15, status: "PARTIAL", activePurchases: 1 });
    // value weights: cement 2000, bearing 1200, nozzle 400, bolt 600 (total 4200); done = 5/20*2000 + 600 = 1100
    expect(row.completionBasis).toBe("value");
    expect(row.completionPercent).toBe(26.2);
    const after = await overview();
    expect(after.items.partiallyPurchased - before.items.partiallyPurchased).toBe(1);
    expect(after.partial.requests - before.partial.requests).toBe(1);
    expect(after.cost.openRequests - before.cost.openRequests).toBeCloseTo(5 * 123.45 + 60, 2);
  });

  it("excludes voided purchases from active totals but keeps them in the history", async () => {
    const b = await classified();
    const wrong = await buyRow(b, "cement", 20, 100, hAgo(5), { voidedAt: hAgo(4) });
    await buyRow(b, "cement", 12, 90, hAgo(4), { replacesId: wrong.id }); // the corrected purchase
    const row = await rowFor(b);
    expect(row.items.find((i) => i.itemId === b.item.cement)).toMatchObject({ purchased: 12, outstanding: 8, status: "PARTIAL", activePurchases: 1 });
    expect(row.actualCost).toBeCloseTo(12 * 90, 2);
    const detail = (await getProcurementRequestDetail(b.requestId, ASOF, 72))!;
    expect(detail.purchases).toHaveLength(2);
    expect(detail.purchases.find((p) => p.id === wrong.id)).toMatchObject({ voided: true, voidReason: "Буруу бүртгэсэн", quantity: 20 });
    expect(detail.purchases.find((p) => p.replacesId === wrong.id)).toMatchObject({ voided: false, quantity: 12 });
  });

  it("a fully voided item is outstanding again and costs nothing", async () => {
    const b = await classified();
    await buyRow(b, "cement", 20, 100, hAgo(5), { voidedAt: hAgo(4) });
    const row = await rowFor(b);
    expect(row.items.find((i) => i.itemId === b.item.cement)).toMatchObject({ purchased: 0, status: "NOT_STARTED", actualCost: 0 });
    expect(row.actualCost).toBe(0);
  });

  it("aggregates actual cost over the selected range only", async () => {
    const b = await classified();
    const before = await overview();
    await buyRow(b, "cement", 2, 50, hAgo(3));
    await buyRow(b, "bolt", 3, 30, hAgo(2), { voidedAt: hAgo(1) }); // voided: excluded
    const after = await overview();
    expect(after.cost.inRange - before.cost.inRange).toBeCloseTo(100, 2);
    expect(after.cost.purchasesInRange - before.cost.purchasesInRange).toBe(1);
    const narrow = await overview(72, resolveRange("7d", ASOF));
    expect(narrow.cost.inRange).toBeGreaterThanOrEqual(100);
  });
});

describe("time calculations from real timestamps", () => {
  it("measures classification wait, age, idle time and the oldest unfinished work", async () => {
    const waiting = await build({ classify: false, entered: hAgo(5) });
    const done = await classified({ entered: hAgo(10), classifiedAt: hAgo(6), assignedAt: hAgo(6) });
    await buyRow(done, "cement", 5, 100, hAgo(2));
    const w = await rowFor(waiting);
    expect(w).toMatchObject({ ageSeconds: 5 * 3600, classificationWaitSeconds: 5 * 3600, classifiedAt: null });
    const d = await rowFor(done);
    expect(d.classificationWaitSeconds).toBe(4 * 3600); // entered 10h ago, classified 6h ago
    expect(d.ageSeconds).toBe(10 * 3600);
    expect(d.idleSeconds).toBe(2 * 3600); // last meaningful activity: the purchase 2h ago
    expect(d.lastActivityAt).toBe(hAgo(2).toISOString());
  });

  it("reports time under the responsible manager from the assignment time", async () => {
    await classified({ entered: hAgo(20), classifiedAt: hAgo(12), assignedAt: hAgo(12) });
    const o = await overview();
    const a = o.managers.find((m) => m.userId === ids.mgrA && m.kind === "DOMESTIC")!;
    expect(a).toMatchObject({ requests: 1, items: 2 });
    expect(a.oldestSeconds).toBe(12 * 3600);
    expect(o.managers.find((m) => m.userId === ids.mgrB && m.kind === "INTERNATIONAL")).toMatchObject({ requests: 1, items: 2 });
  });

  it("handles missing timestamps without inventing values", async () => {
    const before = await overview();
    const b = await classified({ entered: null, classifiedAt: hAgo(6), assignedAt: hAgo(6) });
    const row = await rowFor(b);
    expect(row.enteredAt).toBeNull();
    expect(row.ageSeconds).toBeNull();
    expect(row.classificationWaitSeconds).toBeNull();
    expect(row.lastActivityAt).toBe(hAgo(6).toISOString()); // still known from the classification / assignment
    const after = await overview();
    expect(after.requests.missingTimestamps - before.requests.missingTimestamps).toBe(1);

    const noTimes = await build({ classify: false, entered: null });
    const bare = await rowFor(noTimes);
    expect(bare).toMatchObject({ ageSeconds: null, idleSeconds: null, lastActivityAt: null, delayed: false });
  });

  it("oldest unfinished work ignores requests whose entry time is unknown", async () => {
    await build({ classify: false, entered: null });
    const old = await classified({ entered: new Date("2026-01-01T00:00:00Z") });
    const o = await overview();
    expect(o.timing.oldest).toMatchObject({ requestId: old.requestId, enteredAt: "2026-01-01T00:00:00.000Z" });
  });

  it("the delay threshold is a viewer-chosen filter on idle time, not a stored SLA", async () => {
    const stale = await classified({ entered: hAgo(40), classifiedAt: hAgo(39), assignedAt: hAgo(39) });
    await buyRow(stale, "cement", 1, 10, hAgo(30));
    const fresh = await classified({ entered: hAgo(40), classifiedAt: hAgo(39), assignedAt: hAgo(39) });
    await buyRow(fresh, "cement", 1, 10, hAgo(1));

    const delayed = await getProcurementList(ASOF, listOpts({ filter: "delayed", thresholdHours: 24 }));
    expect(delayed.thresholdHours).toBe(24);
    expect(delayed.rows.map((r) => r.requestId)).toEqual([stale.requestId]);
    expect(delayed.rows[0].delayed).toBe(true);
    expect((await rowFor(fresh, { thresholdHours: 24 })).delayed).toBe(false);
    expect((await rowsOf({ filter: "delayed", thresholdHours: 72 })).map((r) => r.requestId)).not.toContain(stale.requestId);

    const base = await overview(72);
    const tight = await overview(24);
    expect(tight.thresholdHours).toBe(24);
    expect(tight.requests.idleOverThreshold).toBeGreaterThanOrEqual(base.requests.idleOverThreshold + 1);
  });
});

describe("manager handover", () => {
  it("shows the new manager, the moved workload and the handover history", async () => {
    const b = await classified();
    await buyRow(b, "cement", 5, 100, hAgo(3));
    const moved = await executeHandover({ position: "DOMESTIC_PROCUREMENT_MANAGER", newManagerId: ids.mgrA2, actorId: ids.admin, reason: "Ажлаас гарсан", clientRequestId: `pm-h-${TAG}`, expectedItems: 2 });
    expect(moved.ok).toBe(true);

    const row = await rowFor(b);
    expect(row.domestic?.managers).toEqual([ids.mgrA2]);
    expect(row.items.find((i) => i.itemId === b.item.cement)).toMatchObject({ managerId: ids.mgrA2, purchased: 5, outstanding: 15 }); // remaining only
    const o = await overview();
    expect(o.managers.find((m) => m.userId === ids.mgrA2)).toMatchObject({ kind: "DOMESTIC", items: 2, requests: 1 });
    expect(o.managers.find((m) => m.userId === ids.mgrA)).toBeUndefined();

    const detail = (await getProcurementRequestDetail(b.requestId, new Date(), 72))!;
    expect(detail.handovers).toHaveLength(2);
    expect(detail.handovers[0]).toMatchObject({ fromManagerName: ids.mgrA, toManagerName: ids.mgrA2, reason: "Ажлаас гарсан", handoverId: `pm-h-${TAG}` });
    expect(detail.purchases[0].purchasedByName).toBe(ids.mgrA); // history keeps the original manager
  });
});

describe("completion and the accounting transition", () => {
  it("moves a completed request out of the active list into the accounting list, then into completed", async () => {
    const b = await classified();
    await buyRow(b, "cement", 20, 100, hAgo(3));
    await buyRow(b, "bolt", 6, 100, hAgo(3));
    await buyRow(b, "bearing", 12, 100, hAgo(3), { by: ids.mgrB });
    await buyRow(b, "nozzle", 4, 100, hAgo(3), { by: ids.mgrB });
    expect((await rowFor(b)).stage).toBe("READY_TO_COMPLETE");
    expect((await rowsOf({ filter: "ready" })).map((r) => r.requestId)).toContain(b.requestId);

    const now = new Date();
    const range = resolveRange("all", now);
    const before = await overview(72, range, now);
    expect((await completeProcurement(b.requestId, ids.mgrA)).ok).toBe(true);
    const after = await overview(72, range, now);
    expect(after.requests.completedInRange - before.requests.completedInRange).toBe(1);
    expect(after.requests.awaitingAccounting - before.requests.awaitingAccounting).toBe(1);
    expect(after.requests.awaitingProcurement - before.requests.awaitingProcurement).toBe(-1);

    expect((await rowsOf({}, now)).map((r) => r.requestId)).not.toContain(b.requestId);
    const accounting = await rowsOf({ scope: "accounting", range }, now);
    expect(accounting.find((r) => r.requestId === b.requestId)).toMatchObject({ stage: "AWAITING_ACCOUNTING", completionPercent: 100 });
    expect((await rowsOf({ scope: "completed", range }, now)).map((r) => r.requestId)).toContain(b.requestId);

    // accounting records it -> procurement completed (and no longer awaiting accounting)
    const request = await prisma.materialRequest.findUniqueOrThrow({ where: { id: b.requestId } });
    expect((await recordAccountingEntry(b.requestId, ids.acct, { ledgerNumber: `L-${TAG}`, recordDate: new Date() }, request.version)).ok).toBe(true);
    expect((await rowsOf({ scope: "accounting", range }, now)).map((r) => r.requestId)).not.toContain(b.requestId);
    expect((await rowsOf({ scope: "completed", range }, now)).find((r) => r.requestId === b.requestId)).toMatchObject({ stage: "PROCUREMENT_COMPLETED" });
  });

  it("leaves older requests that never had a procurement stage out of every procurement list", async () => {
    const legacy = await classified({ status: "PENDING_ACCOUNTING", noProcurementStep: true });
    for (const scope of ["active", "accounting", "completed"] as const) {
      expect((await rowsOf({ scope })).map((r) => r.requestId)).not.toContain(legacy.requestId);
    }
    expect(await getProcurementRequestDetail(legacy.requestId, ASOF, 72)).toBeNull();
  });
});

describe("pagination, filtering and search", () => {
  it("pages in SQL, oldest first, with a stable total", async () => {
    const built: Built[] = [];
    for (let n = 0; n < 5; n++) built.push(await classified({ entered: hAgo(50 - n * 5) })); // built[0] is the oldest
    const p1 = await getProcurementList(ASOF, listOpts({ pageSize: 2, page: 1 }));
    const p2 = await getProcurementList(ASOF, listOpts({ pageSize: 2, page: 2 }));
    const p3 = await getProcurementList(ASOF, listOpts({ pageSize: 2, page: 3 }));
    const p4 = await getProcurementList(ASOF, listOpts({ pageSize: 2, page: 4 }));
    expect([p1.total, p2.total, p3.total]).toEqual([5, 5, 5]);
    expect([p1.rows.length, p2.rows.length, p3.rows.length, p4.rows.length]).toEqual([2, 2, 1, 0]);
    expect([...p1.rows, ...p2.rows, ...p3.rows].map((r) => r.requestId)).toEqual(built.map((b) => b.requestId));
    expect(p4.total).toBe(5); // a page past the end still reports the total
  });

  it("filters by track, partial purchasing, readiness and classification, and searches by number, department and material", async () => {
    const shared = await classified();
    const domesticOnly = await classified({ classify: [] });
    const waiting = await build({ classify: false });
    await buyRow(shared, "cement", 5, 100, hAgo(1));
    const ids_ = async (filter: ProcurementListOptions["filter"]) => (await rowsOf({ filter })).map((r) => r.requestId).sort();
    expect(await ids_("all")).toEqual([shared.requestId, domesticOnly.requestId, waiting.requestId].sort());
    expect(await ids_("international")).toEqual([shared.requestId]);
    expect(await ids_("domestic")).toEqual([shared.requestId, domesticOnly.requestId].sort());
    expect(await ids_("partial")).toEqual([shared.requestId]);
    expect(await ids_("classification")).toEqual([waiting.requestId]);
    expect(await ids_("ready")).toEqual([]);

    expect((await rowsOf({ q: shared.number })).map((r) => r.requestId)).toEqual([shared.requestId]);
    expect((await rowsOf({ q: `PM${TAG} цех` })).length).toBe(3); // department
    expect((await rowsOf({ q: `${NUM}`.toLowerCase() })).length).toBe(3); // case-insensitive
    expect((await rowsOf({ q: `PM${TAG} NOZZLE` })).length).toBe(3); // material name
    expect((await rowsOf({ q: `${NUM}-%` })).length).toBe(0); // LIKE wildcards are escaped
  });
});

describe("detail view", () => {
  it("returns the stage, material progress, purchases, audit timeline and classification of one request", async () => {
    const raw = await build({ classify: false, entered: null });
    const cls = await classifyProcurement(raw.requestId, ids.mgrB, [raw.item.bearing]);
    expect(cls.ok).toBe(true);
    expect((await recordPurchase(raw.requestId, ids.mgrA, { itemId: raw.item.cement, quantity: 4, unitPrice: 10 })).ok).toBe(true);
    const purchase = await prisma.procurementPurchase.findFirstOrThrow({ where: { requestItemId: raw.item.cement } });
    expect((await voidPurchase(raw.requestId, ids.mgrA, purchase.id, "Буруу тоо")).ok).toBe(true);

    const d = (await getProcurementRequestDetail(raw.requestId, new Date(), 72))!;
    expect(d.row).toMatchObject({ requestId: raw.requestId, requestNumber: raw.number, department: `PM${TAG} цех`, stage: "IN_PROCUREMENT" });
    expect(d.row.domestic?.managers).toEqual([ids.mgrA]);
    expect(d.row.international?.managers).toEqual([ids.mgrB]);
    expect(d.classification).toMatchObject({ confirmedByName: ids.mgrB });
    expect(d.timeline.map((e) => e.action)).toEqual(expect.arrayContaining(["PROCUREMENT_CLASSIFY", "PROCUREMENT_PURCHASE", "PROCUREMENT_VOID"]));
    expect(d.timeline.find((e) => e.action === "PROCUREMENT_VOID")?.summary).toBe("Буруу тоо");
    const times = d.timeline.map((e) => e.at);
    expect([...times].sort()).toEqual(times); // chronological
    expect(await getProcurementRequestDetail("pm-no-such-request", ASOF, 72)).toBeNull();
  });
});

describe("live refresh triggers", () => {
  /** Counts the process-wide broadcast signals the SSE stream turns into client refreshes. */
  const signals = () => {
    let n = 0;
    const handler = (e: { type: string }) => {
      if (e.type === "request-changed") n += 1;
    };
    eventBus.on("broadcast", handler);
    return { count: () => n, stop: () => eventBus.off("broadcast", handler) };
  };

  it("every procurement mutation and the accounting transition signal the monitoring page", async () => {
    const b = await build({ classify: false });
    const s = signals();
    try {
      let last = 0;
      const bumped = (label: string) => {
        expect(s.count(), label).toBeGreaterThan(last);
        last = s.count();
      };
      expect((await classifyProcurement(b.requestId, ids.mgrB, [b.item.bearing, b.item.nozzle])).ok).toBe(true);
      bumped("classification");
      const bought = await recordPurchase(b.requestId, ids.mgrA, { itemId: b.item.cement, quantity: 20, unitPrice: 10 });
      expect(bought.ok).toBe(true);
      bumped("purchase");
      const purchase = await prisma.procurementPurchase.findFirstOrThrow({ where: { requestItemId: b.item.cement } });
      expect((await voidPurchase(b.requestId, ids.mgrA, purchase.id, "Залруулга", { quantity: 20, unitPrice: 12 })).ok).toBe(true);
      bumped("void / correction");
      const handed = await executeHandover({ position: "DOMESTIC_PROCUREMENT_MANAGER", newManagerId: ids.mgrA2, actorId: ids.admin, reason: "Шилжүүлэлт", clientRequestId: `pm-live-${TAG}`, expectedItems: 1 }); // cement is fully bought: only bolt is unfinished
      expect(handed.ok).toBe(true);
      bumped("handover");
      for (const [k, who, qtyN] of [["bolt", ids.mgrA2, 6], ["bearing", ids.mgrB, 12], ["nozzle", ids.mgrB, 4]] as const) {
        expect((await recordPurchase(b.requestId, who, { itemId: b.item[k], quantity: qtyN, unitPrice: 5 })).ok).toBe(true);
      }
      last = s.count();
      expect((await completeProcurement(b.requestId, ids.mgrA2)).ok).toBe(true);
      bumped("procurement completed");
      const request = await prisma.materialRequest.findUniqueOrThrow({ where: { id: b.requestId } });
      expect(request.status).toBe("PENDING_ACCOUNTING");
      expect((await recordAccountingEntry(b.requestId, ids.acct, { ledgerNumber: `L2-${TAG}`, recordDate: new Date() }, request.version)).ok).toBe(true);
      bumped("accounting transition");
    } finally {
      s.stop();
    }
  });

  it("the monitoring page refreshes on the app's single SSE stream, with a catch-up after a reconnect", async () => {
    const { readFileSync } = await import("node:fs");
    const live = readFileSync("components/monitoring/useLiveData.ts", "utf8");
    expect(live).toContain("window.addEventListener(LIVE_EVENT");
    expect(live).toContain("visibilitychange");
    const loader = readFileSync("components/requests/RequestsLoader.tsx", "utf8");
    expect(loader.match(/new EventSource\(/g)).toHaveLength(1); // no second connection anywhere
    expect(loader).toContain("es.onopen");
    expect(readFileSync("components/monitoring/ProcurementMonitoring.tsx", "utf8")).not.toContain("EventSource");
  });
});
