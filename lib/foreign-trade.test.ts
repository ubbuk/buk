import bcrypt from "bcrypt";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  addAttachments,
  addQuote,
  decide,
  deleteQuote,
  createOrder,
  getAttachmentFile,
  getOrder,
  listOrders,
  loadActor,
  postMessage,
  selectSupplier,
  shareResearch,
  submitOrder,
  submitToTechnical,
  updateQuote,
  type FtOrderView,
} from "@/lib/foreign-trade";
import { compareQuotes, ftAccess } from "@/lib/foreign-trade-rules";
import type { FtActor } from "@/lib/foreign-trade-rules";

// The foreign trade workflow end to end on the isolated test database: roles and positions, visibility, the OR technical
// review (including two approvers racing), returns, discussion and notification rules, PIN, audit. Runs against
// TEST_DATABASE_URL only (vitest.setup.ts).
const P = "ft-";
const PIN = "4321";
const POSITIONS = ["OPERATIONS_DIRECTOR", "ENGINEERING_CHIEF", "FINANCE_DIRECTOR", "EXECUTIVE_DIRECTOR"] as const;
const roster = {
  boss: "BOSS",
  boss2: "BOSS",
  mgr: "MANAGER",
  mgr2: "MANAGER",
  ops: "DIRECTOR", // OPERATIONS_DIRECTOR
  eng: "ENGINEERING", // ENGINEERING_CHIEF
  fin: "DIRECTOR", // FINANCE_DIRECTOR
  exec: "DIRECTOR", // EXECUTIVE_DIRECTOR
  idleDirector: "DIRECTOR", // a DIRECTOR with no position
  acct: "CHIEF_ACCOUNTANT",
  emp: "EMPLOYEE",
  admin: "ADMIN",
} as const;
type Who = keyof typeof roster;
const uid = (w: Who) => `${P}${w}`;
const holders: Record<(typeof POSITIONS)[number], Who> = { OPERATIONS_DIRECTOR: "ops", ENGINEERING_CHIEF: "eng", FINANCE_DIRECTOR: "fin", EXECUTIVE_DIRECTOR: "exec" };

const actors = {} as Record<Who, FtActor>;
let previouslyActive: { id: string }[] = [];

const item = { name: "Hydraulic pump", techSpec: "250 bar", quantity: 2, unit: "ш" };
const quote = (over: Record<string, unknown> = {}) => ({ supplierName: "Shenzhen Hydro", country: "China", currency: "USD", price: 1000, shippingCost: 50, leadTimeDays: 30, warranty: "12 сар", ...over });

async function cleanup() {
  await prisma.notification.deleteMany({ where: { userId: { startsWith: P } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: P } } });
  await prisma.foreignTradeOrder.deleteMany({ where: { createdById: { startsWith: P } } });
  await prisma.approvalRoleAssignment.deleteMany({ where: { userId: { startsWith: P } } });
  await prisma.approvalPinCredential.deleteMany({ where: { userId: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
}

beforeAll(async () => {
  await cleanup();
  previouslyActive = await prisma.approvalRoleAssignment.findMany({ where: { isActive: true, role: { in: [...POSITIONS] } }, select: { id: true } });
  await prisma.approvalRoleAssignment.updateMany({ where: { id: { in: previouslyActive.map((r) => r.id) } }, data: { isActive: false, endedAt: new Date() } });
  const pinHash = await bcrypt.hash(PIN, 10);
  await prisma.user.createMany({
    data: (Object.keys(roster) as Who[]).map((w) => ({ id: uid(w), email: `${uid(w)}@test.local`, name: `${P}${w}`, passwordHash: "x", role: roster[w] as never })),
  });
  for (const w of ["ops", "eng", "fin", "exec"] as const) await prisma.approvalPinCredential.create({ data: { userId: uid(w), pinHash } });
  for (const [position, who] of Object.entries(holders)) await prisma.approvalRoleAssignment.create({ data: { role: position as never, userId: uid(who) } });
  for (const w of Object.keys(roster) as Who[]) actors[w] = await loadActor({ id: uid(w), role: roster[w] });
});

afterAll(async () => {
  await cleanup();
  await prisma.approvalRoleAssignment.updateMany({ where: { id: { in: previouslyActive.map((r) => r.id) } }, data: { isActive: true, endedAt: null } });
});

const unread = (w: Who, orderId: string) => prisma.notification.findMany({ where: { userId: uid(w), relatedForeignTradeId: orderId } });
const must = <T,>(r: { ok: true; data: T } | { ok: false; status: number; error: string }): T => {
  if (!r.ok) throw new Error(`expected ok, got ${r.status} ${r.error}`);
  return r.data;
};
const view = async (w: Who, id: string): Promise<FtOrderView | null> => getOrder(actors[w], id);

/** A new order submitted by boss, with one quote selected, ready for technical review. */
async function orderAt(stage: "manager" | "technical" = "technical") {
  const { id } = must(await createOrder(actors.boss, { purpose: "Replace the worn pump", items: [item] }, true));
  if (stage === "manager") return id;
  const { id: quoteId } = must(await addQuote(actors.mgr, id, quote()));
  must(await selectSupplier(actors.mgr, id, quoteId, "Best price and lead time agreed in the discussion"));
  const v = (await view("mgr", id))!;
  must(await submitToTechnical(actors.mgr, id, v.version));
  return id;
}
const approve = async (w: Who, id: string, pin = PIN) => decide(actors[w], id, { action: "APPROVE", pin, expectedVersion: (await view("admin", id))!.version });

describe("rules (pure)", () => {
  it("compares quotes only within one currency and never converts", () => {
    const m = compareQuotes([
      { id: "a", currency: "USD", price: 100, shippingCost: 10, leadTimeDays: 30 },
      { id: "b", currency: "USD", price: 90, shippingCost: 5, leadTimeDays: 45 },
      { id: "c", currency: "EUR", price: 1, shippingCost: 0, leadTimeDays: 10 },
    ]);
    expect(m.get("b")!.cheapestInCurrency).toBe(true);
    expect(m.get("a")!.cheapestInCurrency).toBe(false);
    expect(m.get("c")!.cheapestInCurrency).toBe(false); // alone in its currency: never ranked
    expect(m.get("c")!.fastest).toBe(true);
    expect(m.get("a")!.total).toBe(110);
  });

  it("a DIRECTOR without a position can do nothing; a BOSS sees only their own order", () => {
    const facts = { createdById: "x", status: "PENDING_TECHNICAL" as const, sharedWithBoss: false, sharedWithTechnical: true, passedTechnical: false, passedFinance: false };
    const idle = ftAccess(facts, { id: "d", role: "DIRECTOR", positions: [] });
    expect(idle.view).toBe(false);
    expect(ftAccess(facts, { id: "other", role: "BOSS", positions: [] }).view).toBe(false);
    expect(ftAccess(facts, { id: "x", role: "BOSS", positions: [] }).view).toBe(true);
  });
});

describe("creation, visibility and the price research", () => {
  it("only a BOSS creates; submitting notifies every MANAGER and nobody else", async () => {
    expect((await createOrder(actors.mgr, { items: [item] }, true)).ok).toBe(false);
    expect((await createOrder(actors.emp, { items: [item] }, true)).ok).toBe(false);
    const id = await orderAt("manager");
    expect((await unread("mgr", id)).map((n) => n.type)).toEqual(["FOREIGN_TRADE_UPDATE"]);
    expect(await unread("mgr2", id)).toHaveLength(1);
    for (const w of ["boss", "ops", "eng", "fin", "exec", "acct"] as const) expect(await unread(w, id), w).toHaveLength(0);
    const o = await prisma.foreignTradeOrder.findUniqueOrThrow({ where: { id } });
    expect(o.orderNumber).toMatch(/^FT-\d{4}-\d{4}$/);
    expect(o.status).toBe("PENDING_MANAGER");
  });

  it("who can open the order before anything is presented", async () => {
    const id = await orderAt("manager");
    expect(await view("boss", id)).not.toBeNull();
    expect(await view("mgr", id)).not.toBeNull();
    expect(await view("admin", id)).not.toBeNull();
    for (const w of ["boss2", "ops", "eng", "fin", "exec", "idleDirector", "acct", "emp"] as const) expect(await view(w, id), w).toBeNull();
    // a draft is the BOSS's own: not even the MANAGER sees it
    const draft = must(await createOrder(actors.boss, { items: [item] }, false)).id;
    expect(await view("mgr", draft)).toBeNull();
    expect(await view("boss", draft)).not.toBeNull();
  });

  it("only a MANAGER researches prices; the BOSS sees quotes only once they are presented", async () => {
    const id = await orderAt("manager");
    for (const w of ["boss", "admin", "ops"] as const) expect((await addQuote(actors[w], id, quote())).ok, w).toBe(false);
    const q = must(await addQuote(actors.mgr, id, quote()));
    expect((await view("boss", id))!.quotes).toBeNull();
    expect((await view("mgr", id))!.quotes).toHaveLength(1);

    must(await shareResearch(actors.mgr, id, { boss: true }));
    expect((await view("boss", id))!.quotes).toHaveLength(1);
    expect(await view("ops", id)).toBeNull(); // presenting to the BOSS says nothing about technical review
    expect((await unread("boss", id)).some((n) => n.type === "FOREIGN_TRADE_UPDATE")).toBe(true);

    must(await shareResearch(actors.mgr, id, { technical: true }));
    expect(await view("ops", id)).not.toBeNull();
    expect(await view("eng", id)).not.toBeNull();
    // ... but sharing is not an approval request
    for (const w of ["ops", "eng"] as const) expect((await unread(w, id)).every((n) => n.type !== "FOREIGN_TRADE_APPROVAL"), w).toBe(true);
    expect((await view("ops", id))!.status).toBe("PENDING_MANAGER");
    expect(q.id).toBeTruthy();
  });

  it("needs a recorded supplier and rationale before technical review, and the choice is audited", async () => {
    const id = await orderAt("manager");
    const { id: quoteId } = must(await addQuote(actors.mgr, id, quote()));
    const v = (await view("mgr", id))!;
    expect((await submitToTechnical(actors.mgr, id, v.version)).ok).toBe(false);
    expect((await selectSupplier(actors.boss, id, quoteId, "I choose this one")).ok).toBe(false);
    must(await selectSupplier(actors.mgr, id, quoteId, "Agreed in the discussion: lowest total"));
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "ForeignTradeOrder", entityId: id, action: "FT_SELECT_SUPPLIER" } });
    expect(audit.actorId).toBe(uid("mgr"));
    expect(audit.afterJson).toContain("Agreed in the discussion");
    must(await submitToTechnical(actors.mgr, id, v.version));
  });

  it("a quote cannot be changed once the order left the MANAGER; the selected one cannot be deleted", async () => {
    const id = await orderAt("manager");
    const a = must(await addQuote(actors.mgr, id, quote()));
    const b = must(await addQuote(actors.mgr, id, quote({ supplierName: "Other" })));
    must(await selectSupplier(actors.mgr, id, a.id, "Best option overall"));
    expect((await deleteQuote(actors.mgr, id, a.id)).ok).toBe(false);
    const changed = must(await updateQuote(actors.mgr, id, a.id, quote({ price: 900 })));
    expect(changed.selectionCleared).toBe(true); // the choice was made for the old offer
    expect((await view("mgr", id))!.selection).toBeNull();
    must(await selectSupplier(actors.mgr, id, b.id, "Second supplier is fine"));
    must(await submitToTechnical(actors.mgr, id, (await view("mgr", id))!.version));
    expect((await addQuote(actors.mgr, id, quote())).ok).toBe(false);
    expect((await updateQuote(actors.mgr, id, b.id, quote({ price: 1 }))).ok).toBe(false);
    expect((await deleteQuote(actors.mgr, id, a.id)).ok).toBe(false);
  });
});

describe("technical review is an OR", () => {
  it("both positions are asked; either may decide; the other finds the stage decided", async () => {
    const id = await orderAt();
    for (const w of ["ops", "eng"] as const) expect((await unread(w, id)).map((n) => n.type), w).toEqual(["FOREIGN_TRADE_APPROVAL"]);
    for (const w of ["boss", "fin", "exec", "acct"] as const) expect((await unread(w, id)).filter((n) => n.type === "FOREIGN_TRADE_APPROVAL"), w).toHaveLength(0);

    const v = (await view("ops", id))!;
    expect(v.access.decisionStage).toBe("TECHNICAL");
    expect(v.waitingOnMe).toBe(true);
    expect((await view("mgr", id))!.access.decisionStage).toBeNull();
    expect((await decide(actors.boss, id, { action: "APPROVE", pin: PIN, expectedVersion: v.version })).ok).toBe(false);
    expect((await decide(actors.mgr, id, { action: "APPROVE", pin: PIN, expectedVersion: v.version })).ok).toBe(false);

    // two approvers (and a double click) at the same time: exactly one decision
    const results = await Promise.all([
      decide(actors.ops, id, { action: "APPROVE", pin: PIN, expectedVersion: v.version }),
      decide(actors.eng, id, { action: "APPROVE", pin: PIN, expectedVersion: v.version }),
      decide(actors.ops, id, { action: "APPROVE", pin: PIN, expectedVersion: v.version }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.status === 409)).toBe(true);

    const decisions = await prisma.foreignTradeDecision.findMany({ where: { orderId: id } });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ stage: "TECHNICAL", action: "APPROVE", cycle: 1 });
    const winner = decisions[0].decidedById;
    const audits = await prisma.auditLog.findMany({ where: { entityType: "ForeignTradeOrder", entityId: id, action: "APPROVE" } });
    expect(audits).toHaveLength(1);
    expect(audits[0].actorId).toBe(winner);
    expect((await view("ops", id))!.status).toBe("PENDING_FINANCE");

    // the loser's "decision needed" notice is settled; finance director is asked; nobody else yet
    const loser = winner === uid("ops") ? "eng" : "ops";
    expect((await unread(loser, id)).filter((n) => n.type === "FOREIGN_TRADE_APPROVAL").every((n) => n.isRead)).toBe(true);
    expect((await unread("fin", id)).map((n) => n.type)).toEqual(["FOREIGN_TRADE_APPROVAL"]);
    expect(await unread("exec", id)).toHaveLength(0);
    expect(await unread("acct", id)).toHaveLength(0);
    // a second approval after the fact is refused, not applied again
    expect((await approve("eng", id)).ok).toBe(false);
    expect((await approve("ops", id)).ok).toBe(false);
  });

  it("approving needs the PIN of the approver; a wrong PIN changes nothing", async () => {
    const id = await orderAt();
    const v = (await view("ops", id))!;
    const wrong = await decide(actors.ops, id, { action: "APPROVE", pin: "0000", expectedVersion: v.version });
    expect(wrong.ok).toBe(false);
    const none = await decide(actors.ops, id, { action: "APPROVE", expectedVersion: v.version });
    expect(none.ok).toBe(false);
    expect((await view("ops", id))!.status).toBe("PENDING_TECHNICAL");
    expect(await prisma.foreignTradeDecision.count({ where: { orderId: id } })).toBe(0);
    expect((await decide(actors.ops, id, { action: "APPROVE", pin: PIN, expectedVersion: v.version })).ok).toBe(true);
  });

  it("a stale copy cannot decide", async () => {
    const id = await orderAt();
    const v = (await view("ops", id))!;
    expect((await decide(actors.ops, id, { action: "APPROVE", pin: PIN, expectedVersion: v.version + 5 })).ok).toBe(false);
    expect((await view("ops", id))!.status).toBe("PENDING_TECHNICAL");
  });

  it("a return needs a reason and goes back to the MANAGER, who fixes it and resubmits", async () => {
    const id = await orderAt();
    const v = (await view("eng", id))!;
    expect((await decide(actors.eng, id, { action: "RETURN", expectedVersion: v.version })).ok).toBe(false);
    must(await decide(actors.eng, id, { action: "RETURN", reason: "Pressure rating is not enough", expectedVersion: v.version }));
    const o = (await view("mgr", id))!;
    expect(o.status).toBe("RETURNED_TO_MANAGER");
    expect(o.decisions[0]).toMatchObject({ action: "RETURN", reason: "Pressure rating is not enough" });
    expect((await unread("mgr", id)).some((n) => n.body.includes("Pressure rating"))).toBe(true);
    expect(await unread("fin", id)).toHaveLength(0);

    const other = (await addQuote(actors.mgr, id, quote({ supplierName: "Better supplier" }))) as { ok: true; data: { id: string } };
    must(await selectSupplier(actors.mgr, id, other.data.id, "Meets the pressure rating"));
    must(await submitToTechnical(actors.mgr, id, (await view("mgr", id))!.version));
    expect((await prisma.foreignTradeOrder.findUniqueOrThrow({ where: { id } })).cycle).toBe(2);
    must(await approve("ops", id));
    expect((await view("mgr", id))!.status).toBe("PENDING_FINANCE");
    expect(await prisma.foreignTradeDecision.count({ where: { orderId: id } })).toBe(2);
  });
});

describe("finance, executive and the finance department", () => {
  it("runs the whole chain; each stage is decided only by its holder and announced only to the next one", async () => {
    const id = await orderAt();
    expect(await view("fin", id)).toBeNull(); // not before technical review is done
    must(await approve("eng", id));

    expect(await view("fin", id)).not.toBeNull();
    expect(await view("exec", id)).toBeNull();
    expect(await view("acct", id)).toBeNull();
    for (const w of ["ops", "eng", "exec", "idleDirector", "boss", "mgr"] as const) {
      expect((await approve(w, id)).ok, `${w} must not decide the finance stage`).toBe(false);
    }
    must(await approve("fin", id));
    expect((await view("fin", id))!.status).toBe("PENDING_EXECUTIVE");
    expect((await unread("exec", id)).map((n) => n.type)).toEqual(["FOREIGN_TRADE_APPROVAL"]);
    expect(await unread("acct", id)).toHaveLength(0);
    expect(await view("acct", id)).toBeNull(); // not before the executive approves

    expect((await approve("fin", id)).ok).toBe(false);
    must(await approve("exec", id));
    const done = (await view("acct", id))!;
    expect(done.status).toBe("APPROVED");
    expect(done.access.decisionStage).toBeNull();
    expect((await unread("acct", id)).map((n) => n.type)).toEqual(["FOREIGN_TRADE_UPDATE"]);
    expect((await prisma.foreignTradeOrder.findUniqueOrThrow({ where: { id } })).approvedAt).not.toBeNull();
    const stages = (await prisma.foreignTradeDecision.findMany({ where: { orderId: id }, orderBy: { createdAt: "asc" } })).map((d) => d.stage);
    expect(stages).toEqual(["TECHNICAL", "FINANCE", "EXECUTIVE"]);
    // nothing moves an approved order any more
    expect((await approve("exec", id)).ok).toBe(false);
  });

  it("a return by finance or the executive goes to the BOSS with the reason; resubmitting restarts from the MANAGER", async () => {
    const id = await orderAt();
    must(await approve("ops", id));
    const v = (await view("fin", id))!;
    expect((await decide(actors.fin, id, { action: "RETURN", expectedVersion: v.version })).ok).toBe(false);
    must(await decide(actors.fin, id, { action: "RETURN", reason: "Budget is not approved", expectedVersion: v.version }));
    let o = (await view("boss", id))!;
    expect(o.status).toBe("RETURNED_TO_BOSS");
    expect(o.decisions.at(-1)).toMatchObject({ stage: "FINANCE", action: "RETURN", reason: "Budget is not approved" });
    expect((await unread("boss", id)).some((n) => n.body.includes("Budget is not approved"))).toBe(true);
    expect(await unread("exec", id)).toHaveLength(0);

    // only the BOSS who owns it may edit and resubmit
    expect((await submitOrder(actors.boss2, id, o.version)).ok).toBe(false);
    expect((await submitOrder(actors.mgr, id, o.version)).ok).toBe(false);
    must(await submitOrder(actors.boss, id, o.version));
    o = (await view("mgr", id))!;
    expect(o.status).toBe("PENDING_MANAGER");
    expect(o.selection).toBeNull(); // the old choice no longer stands
    const q = o.quotes![0];
    must(await selectSupplier(actors.mgr, id, q.id, "Same supplier after the revision"));
    must(await submitToTechnical(actors.mgr, id, (await view("mgr", id))!.version));
    must(await approve("eng", id));
    must(await approve("fin", id));
    const e = (await view("exec", id))!;
    must(await decide(actors.exec, id, { action: "RETURN", reason: "Postpone to next quarter", expectedVersion: e.version }));
    expect((await view("boss", id))!.status).toBe("RETURNED_TO_BOSS");
    expect(await unread("acct", id)).toHaveLength(0);
  });

  it("two finance approvals at once decide the stage once", async () => {
    const id = await orderAt();
    must(await approve("ops", id));
    const v = (await view("fin", id))!;
    const results = await Promise.all([1, 2, 3].map(() => decide(actors.fin, id, { action: "APPROVE", pin: PIN, expectedVersion: v.version })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await prisma.foreignTradeDecision.count({ where: { orderId: id, stage: "FINANCE" } })).toBe(1);
    expect(await unread("exec", id)).toHaveLength(1);
  });

  it("will not hand an order to a stage nobody holds", async () => {
    const id = await orderAt();
    await prisma.approvalRoleAssignment.updateMany({ where: { userId: uid("fin") }, data: { isActive: false, endedAt: new Date() } });
    try {
      const r = await approve("ops", id);
      expect(r.ok).toBe(false);
      expect((await view("ops", id))!.status).toBe("PENDING_TECHNICAL");
    } finally {
      await prisma.approvalRoleAssignment.updateMany({ where: { userId: uid("fin") }, data: { isActive: true, endedAt: null } });
    }
  });
});

describe("discussion", () => {
  it("is for the BOSS, the MANAGERs and the two technical positions; notices skip the author, finance and executive", async () => {
    const id = await orderAt(); // already shared with technical by submitting
    must(await postMessage(actors.boss, id, { body: "Please check the pump flow rate" }, []));
    for (const w of ["mgr", "mgr2", "ops", "eng"] as const) expect((await unread(w, id)).filter((n) => n.type === "FOREIGN_TRADE_DISCUSSION"), w).toHaveLength(1);
    for (const w of ["boss", "fin", "exec", "acct", "admin"] as const) expect((await unread(w, id)).filter((n) => n.type === "FOREIGN_TRADE_DISCUSSION"), w).toHaveLength(0);

    must(await postMessage(actors.ops, id, { body: "Flow rate is fine" }, []));
    expect((await unread("boss", id)).filter((n) => n.type === "FOREIGN_TRADE_DISCUSSION")).toHaveLength(1);
    expect((await unread("ops", id)).filter((n) => n.type === "FOREIGN_TRADE_DISCUSSION")).toHaveLength(1); // only the BOSS message, not their own

    const msgs = (await view("mgr", id))!.messages!;
    expect(msgs.map((m) => m.author.name)).toEqual([`${P}boss`, `${P}ops`]);
    expect(msgs[0].createdAt).toBeTruthy();

    expect((await postMessage(actors.fin, id, { body: "x" }, [])).ok).toBe(false);
    expect((await postMessage(actors.admin, id, { body: "x" }, [])).ok).toBe(false);
    expect((await postMessage(actors.emp, id, { body: "x" }, [])).ok).toBe(false);
    expect((await postMessage(actors.boss2, id, { body: "x" }, [])).ok).toBe(false);
    expect((await postMessage(actors.boss, id, { body: "   " }, [])).ok).toBe(false);
    const audit = await prisma.auditLog.count({ where: { entityType: "ForeignTradeOrder", entityId: id, action: "FT_MESSAGE" } });
    expect(audit).toBe(2);
  });

  it("the finance director may read the history once the order reaches them, but is never notified", async () => {
    const id = await orderAt();
    must(await postMessage(actors.mgr, id, { body: "Supplier confirmed delivery" }, []));
    expect((await view("fin", id))).toBeNull();
    must(await approve("ops", id));
    expect((await view("fin", id))!.messages).toHaveLength(1);
    must(await postMessage(actors.boss, id, { body: "Thanks" }, []));
    expect((await unread("fin", id)).filter((n) => n.type === "FOREIGN_TRADE_DISCUSSION")).toHaveLength(0);
    expect((await unread("fin", id)).filter((n) => n.type === "FOREIGN_TRADE_APPROVAL")).toHaveLength(1);
  });

  it("technical positions only join once the research is presented to them", async () => {
    const id = await orderAt("manager");
    must(await postMessage(actors.boss, id, { body: "Question for the manager" }, []));
    expect(await unread("ops", id)).toHaveLength(0);
    expect((await postMessage(actors.ops, id, { body: "x" }, [])).ok).toBe(false);
  });

  it("takes files (including the old .xls); refuses other types; quote files follow the price research visibility", async () => {
    const id = await orderAt("manager");
    const xls = { fileName: "price.xls", mimeType: "application/vnd.ms-excel", sizeBytes: 4, buffer: Buffer.from("abcd") };
    const exe = { fileName: "x.exe", mimeType: "application/x-msdownload", sizeBytes: 4, buffer: Buffer.from("abcd") };
    expect((await postMessage(actors.boss, id, { body: "see file" }, [exe])).ok).toBe(false);
    const m = must(await postMessage(actors.boss, id, { body: "" }, [xls]));
    const msg = (await view("mgr", id))!.messages!.find((x) => x.id === m.id)!;
    expect(msg.attachments[0].fileName).toBe("price.xls");
    expect((await getAttachmentFile(actors.mgr, id, msg.attachments[0].id)).ok).toBe(true);
    expect((await getAttachmentFile(actors.boss2, id, msg.attachments[0].id)).ok).toBe(false);
    expect((await getAttachmentFile(actors.fin, id, msg.attachments[0].id)).ok).toBe(false);

    const q = must(await addQuote(actors.mgr, id, quote()));
    expect((await addAttachments(actors.boss, id, [xls], q.id)).ok).toBe(false); // the BOSS does not attach to quotes
    const [qf] = must(await addAttachments(actors.mgr, id, [xls], q.id));
    expect((await getAttachmentFile(actors.boss, id, qf.id)).ok).toBe(false); // not presented to the BOSS yet
    must(await shareResearch(actors.mgr, id, { boss: true }));
    expect((await getAttachmentFile(actors.boss, id, qf.id)).ok).toBe(true);
    expect((await getAttachmentFile(actors.mgr, id, qf.id)).ok && (await getAttachmentFile(actors.boss, id, qf.id)).ok).toBe(true);
  });
});

describe("lists", () => {
  it("each role lists only what it may open, and flags what waits on it", async () => {
    const id = await orderAt();
    const ids = async (w: Who, waiting = false) => (await listOrders(actors[w], { waiting })).map((r) => r.id);
    for (const w of ["boss", "mgr", "ops", "eng", "admin"] as const) expect(await ids(w), w).toContain(id);
    for (const w of ["boss2", "fin", "exec", "acct", "emp", "idleDirector"] as const) expect(await ids(w), w).not.toContain(id);
    expect(await ids("ops", true)).toContain(id);
    expect(await ids("mgr", true)).not.toContain(id);
    expect(await ids("boss", true)).not.toContain(id);
  });
});
