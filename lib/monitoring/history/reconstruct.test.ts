import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { reconstruct } from "./reconstruct";

// Real rows in the isolated test database (see vitest.setup.ts): the audit-log
// reader, the request query and the C++ engine run together. The test database
// also holds other suites' rows, so assertions only look at this suite's
// fixtures (ids prefixed `hist-t-`) and cleanup is exact.
const P = "hist-t-";
const ts = (iso: string) => new Date(iso);
const ids = { dept: `${P}dept`, user: `${P}user`, req: (n: number) => `${P}req-${n}` };

async function cleanup() {
  await prisma.auditLog.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.materialRequest.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.department.deleteMany({ where: { id: { startsWith: P } } });
}

async function mkRequest(n: number, status: string, createdAt: Date, completedAt: Date | null = null) {
  await prisma.materialRequest.create({
    data: { id: ids.req(n), requestNumber: `${P}${n}`, year: 2026, sequence: 8000 + n, departmentId: ids.dept, requestedById: ids.user, status: status as never, createdAt, submittedAt: createdAt, completedAt },
  });
}
let auditSeq = 0;
const audit = (n: number, action: string, at: Date) =>
  prisma.auditLog.create({ data: { id: `${P}a${String(++auditSeq).padStart(3, "0")}`, entityType: "MaterialRequest", entityId: ids.req(n), action: action as never, actorId: ids.user, createdAt: at } });

beforeAll(async () => {
  await cleanup();
  await prisma.department.create({ data: { id: ids.dept, name: "Түүхэн тест цех", type: "FACTORY" } });
  await prisma.user.create({ data: { id: ids.user, email: `${P}u@test.local`, name: "Түүхэн тест", role: "EMPLOYEE", passwordHash: "x", isActive: true, departmentId: ids.dept } });

  // 1: submitted, dept approved, warehouse found shortages -> branch approved -> pending finance (live status agrees)
  await mkRequest(1, "PENDING_FINANCE_APPROVAL", ts("2026-01-01T08:00:00Z"));
  await audit(1, "SUBMIT", ts("2026-01-01T08:00:01Z"));
  await audit(1, "APPROVE", ts("2026-01-01T09:00:00Z"));
  await audit(1, "RESERVE_STOCK", ts("2026-01-01T10:00:00Z"));
  await audit(1, "APPROVE", ts("2026-01-01T11:00:00Z"));
  // 2: everything in stock -> warehouse check completed the request directly
  await mkRequest(2, "COMPLETED", ts("2026-01-01T08:30:00Z"), ts("2026-01-01T10:30:00Z"));
  await audit(2, "SUBMIT", ts("2026-01-01T08:30:01Z"));
  await audit(2, "APPROVE", ts("2026-01-01T09:30:00Z"));
  await audit(2, "RESERVE_STOCK", ts("2026-01-01T10:30:00Z"));
  // 3: exists, but its audit rows are gone (retention / manual import)
  await mkRequest(3, "PENDING_DEPARTMENT_APPROVAL", ts("2026-01-01T08:45:00Z"));
  // 4: created after the moment we reconstruct
  await mkRequest(4, "PENDING_DEPARTMENT_APPROVAL", ts("2026-01-02T08:00:00Z"));
  await audit(4, "SUBMIT", ts("2026-01-02T08:00:01Z"));
});

afterAll(cleanup);

const mine = (r: { requests: { id: string }[] }) => r.requests.filter((x) => x.id.startsWith(P));
const byId = (list: { id: string }[]) => Object.fromEntries(list.map((r) => [r.id, r])) as Record<string, ReturnType<typeof mine>[number] & Record<string, unknown>>;

describe("reconstruct() against real audit rows", () => {
  it("reconstructs each request as it was at the chosen moment", async () => {
    const { result, engine } = await reconstruct(ts("2026-01-01T09:45:00Z"));
    expect(engine.kind).toBe("wasm");
    const r = byId(mine(result));

    expect(r[ids.req(1)]).toMatchObject({ status: "PENDING_WAREHOUSE_CHECK", since: "2026-01-01T09:00:00.000Z", waitingSeconds: 45 * 60 });
    expect(r[ids.req(2)]).toMatchObject({ status: "PENDING_WAREHOUSE_CHECK", since: "2026-01-01T09:30:00.000Z", waitingSeconds: 15 * 60 });
    expect(r[ids.req(4)]).toBeUndefined(); // did not exist yet
    expect(result.asOf).toBe("2026-01-01T09:45:00.000Z");
  });

  it("uses the live status to resolve the warehouse outcome, and agrees with it afterwards", async () => {
    const { result } = await reconstruct(ts("2026-01-01T23:00:00Z"));
    const r = byId(mine(result));
    expect(r[ids.req(1)]).toMatchObject({ status: "PENDING_FINANCE_APPROVAL", flags: [] });
    expect(r[ids.req(2)]).toMatchObject({ status: "COMPLETED", flags: [] });
  });

  it("marks a request with no audit history as unknown and the whole result as incomplete", async () => {
    const { result } = await reconstruct(ts("2026-01-01T23:00:00Z"));
    const r = byId(mine(result));
    expect(r[ids.req(3)]).toMatchObject({ status: "UNKNOWN", since: null, waitingSeconds: null });
    expect(r[ids.req(3)].flags).toContain("NO_HISTORY");
    expect(result.completeness.status).toBe("incomplete");
    expect(result.completeness.reasons.map((x) => x.code)).toContain("NO_HISTORY");
    expect(result.limitations.join(" ")).toMatch(/not a PostgreSQL backup/i);
  });

  it("is deterministic: the same moment reconstructs to the same state hash", async () => {
    const a = await reconstruct(ts("2026-01-01T12:00:00Z"));
    const b = await reconstruct(ts("2026-01-01T12:00:00Z"));
    expect(a.result.stateHash).toBe(b.result.stateHash);
  });

  it("includes the engine inputs only when asked (for snapshots)", async () => {
    const plain = await reconstruct(ts("2026-01-01T12:00:00Z"));
    const full = await reconstruct(ts("2026-01-01T12:00:00Z"), { includeInputs: true });
    expect(plain.inputs).toBeUndefined();
    expect(full.inputs!.requests.length).toBe(full.result.requests.length);
    // requests 1-3 existed by then (7 transition events); request 4 was created later
    expect(full.inputs!.events.length).toBeGreaterThanOrEqual(7);
  });
});
