import bcrypt from "bcrypt";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./prisma";
import { verifyPin } from "./pin";

// PIN attempt counting and lockout against the isolated test database. The counter is changed by
// single atomic SQL statements, so these tests fire many verifications at once (separate pooled
// connections stand in for separate app instances) and check that the limit still holds.
const P = "pin-";
const PIN = "1234";
const WRONG = "0000";
let hash = "";
let counter = 0;

async function freshUser(withPin = true) {
  counter += 1;
  const id = `${P}u${counter}-${Date.now().toString(36)}`;
  await prisma.user.create({ data: { id, email: `${id}@test.local`, name: id, role: "BOSS", passwordHash: "unused" } });
  if (withPin) await prisma.approvalPinCredential.create({ data: { userId: id, pinHash: hash } });
  return id;
}
const credential = (userId: string) => prisma.approvalPinCredential.findUniqueOrThrow({ where: { userId } });
const auditCount = (userId: string, action: "PIN_FAILURE" | "PIN_LOCKOUT") => prisma.auditLog.count({ where: { actorId: userId, action } });
const status = (r: Awaited<ReturnType<typeof verifyPin>>) => (r.ok ? 200 : r.status);

async function cleanup() {
  await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: P } } });
  await prisma.approvalPinCredential.deleteMany({ where: { userId: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
}

beforeAll(async () => {
  await cleanup();
  hash = await bcrypt.hash(PIN, 4);
});
afterAll(cleanup);

describe("sequential behaviour is unchanged", () => {
  it("the right PIN passes and leaves a clean counter", async () => {
    const u = await freshUser();
    expect(await verifyPin(u, PIN)).toEqual({ ok: true });
    expect(await credential(u)).toMatchObject({ failedAttempts: 0, lockedUntil: null });
  });

  it("4 wrong PINs are 401, the 5th locks (423) for 15 minutes, and even the right PIN is then refused", async () => {
    const u = await freshUser();
    for (let i = 1; i <= 4; i++) expect(status(await verifyPin(u, WRONG)), `attempt ${i}`).toBe(401);
    expect(await credential(u)).toMatchObject({ failedAttempts: 4, lockedUntil: null });
    const fifth = await verifyPin(u, WRONG);
    expect(fifth).toMatchObject({ ok: false, status: 423 });
    const locked = await credential(u);
    expect(locked.failedAttempts).toBe(0);
    // 15 minutes from now regardless of the database session time zone
    const minutes = (locked.lockedUntil!.getTime() - Date.now()) / 60000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThan(16);
    expect(status(await verifyPin(u, PIN))).toBe(423);
    expect(status(await verifyPin(u, WRONG))).toBe(423);
    expect(await auditCount(u, "PIN_FAILURE")).toBe(4);
    expect(await auditCount(u, "PIN_LOCKOUT")).toBe(1);
  });

  it("a correct PIN on the 5th attempt is accepted and clears the counter", async () => {
    const u = await freshUser();
    for (let i = 0; i < 4; i++) await verifyPin(u, WRONG);
    expect(await verifyPin(u, PIN)).toEqual({ ok: true });
    expect(await credential(u)).toMatchObject({ failedAttempts: 0, lockedUntil: null });
    // the budget is a fresh 5 again
    for (let i = 0; i < 4; i++) expect(status(await verifyPin(u, WRONG))).toBe(401);
    expect(status(await verifyPin(u, WRONG))).toBe(423);
  });

  it("a success after a few failures resets the count", async () => {
    const u = await freshUser();
    for (let i = 0; i < 3; i++) await verifyPin(u, WRONG);
    expect(await verifyPin(u, PIN)).toEqual({ ok: true });
    expect((await credential(u)).failedAttempts).toBe(0);
  });

  it("an expired lock gives a new budget; the lock is released by the next attempt", async () => {
    const u = await freshUser();
    for (let i = 0; i < 5; i++) await verifyPin(u, WRONG);
    expect(status(await verifyPin(u, PIN))).toBe(423);
    await prisma.approvalPinCredential.update({ where: { userId: u }, data: { lockedUntil: new Date(Date.now() - 60_000) } });
    expect(await verifyPin(u, PIN)).toEqual({ ok: true });
    expect(await credential(u)).toMatchObject({ failedAttempts: 0, lockedUntil: null });
    // after expiry a wrong PIN starts counting from 1 again
    for (let i = 0; i < 5; i++) await verifyPin(u, WRONG);
    await prisma.approvalPinCredential.update({ where: { userId: u }, data: { lockedUntil: new Date(Date.now() - 60_000) } });
    expect(status(await verifyPin(u, WRONG))).toBe(401);
    expect(await credential(u)).toMatchObject({ failedAttempts: 1, lockedUntil: null });
  });

  it("no PIN set is a 400 and never throws; a lockout affects only that account", async () => {
    const none = await freshUser(false);
    expect(await verifyPin(none, PIN)).toMatchObject({ ok: false, status: 400 });
    expect(await verifyPin("pin-no-such-user", PIN)).toMatchObject({ ok: false, status: 400 });
    const a = await freshUser();
    const b = await freshUser();
    for (let i = 0; i < 5; i++) await verifyPin(a, WRONG);
    expect(status(await verifyPin(a, PIN))).toBe(423);
    expect(await verifyPin(b, PIN)).toEqual({ ok: true });
  });

  it("an attempt is counted before the PIN is compared (fail-closed: an interrupted check still costs one)", async () => {
    const u = await freshUser();
    await verifyPin(u, PIN);
    await prisma.$executeRaw`UPDATE "ApprovalPinCredential" SET "failedAttempts" = 4 WHERE "userId" = ${u}`;
    expect(await verifyPin(u, PIN)).toEqual({ ok: true }); // the 5th is still allowed
  });
});

describe("parallel attempts cannot exceed the limit", () => {
  it("40 simultaneous wrong PINs: exactly 5 are checked, the account locks, the other 35 are refused unchecked", async () => {
    const u = await freshUser();
    const results = await Promise.all(Array.from({ length: 40 }, () => verifyPin(u, WRONG)));
    const checked = results.filter((r) => status(r) === 401 || (status(r) === 423 && !r.ok && r.error.includes("түгжигдлээ")));
    expect(checked).toHaveLength(5);
    expect(results.filter((r) => status(r) === 401)).toHaveLength(4);
    expect(results.filter((r) => status(r) === 423)).toHaveLength(36); // the locking attempt + 35 refused
    expect((await auditCount(u, "PIN_FAILURE")) + (await auditCount(u, "PIN_LOCKOUT"))).toBe(5);
    expect(await auditCount(u, "PIN_LOCKOUT")).toBe(1);
    const c = await credential(u);
    expect(c.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    expect(status(await verifyPin(u, PIN))).toBe(423);
  });

  it("a burst that contains the right PIN still gets at most 5 comparisons in total", async () => {
    // 60 guesses fired together, one of them correct: only the first 5 to reach the database are evaluated.
    for (let round = 0; round < 3; round++) {
      const u = await freshUser();
      const pins = Array.from({ length: 60 }, (_, i) => (i === 37 ? PIN : WRONG));
      const results = await Promise.all(pins.map((p) => verifyPin(u, p)));
      const evaluated = results.filter((r) => r.ok || status(r) === 401 || (!r.ok && r.error.includes("түгжигдлээ")));
      expect(evaluated.length).toBeLessThanOrEqual(5);
      expect((await auditCount(u, "PIN_FAILURE")) + (await auditCount(u, "PIN_LOCKOUT"))).toBeLessThanOrEqual(5);
    }
  });

  it("repeated bursts against one account never evaluate more than 5 guesses per lock window", async () => {
    const u = await freshUser();
    for (let wave = 0; wave < 4; wave++) await Promise.all(Array.from({ length: 25 }, () => verifyPin(u, WRONG)));
    expect((await auditCount(u, "PIN_FAILURE")) + (await auditCount(u, "PIN_LOCKOUT"))).toBe(5);
  });

  it("a few simultaneous correct verifications (e.g. a double click) all succeed and leave a clean counter", async () => {
    const u = await freshUser();
    const results = await Promise.all(Array.from({ length: 4 }, () => verifyPin(u, PIN)));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await credential(u)).toMatchObject({ failedAttempts: 0, lockedUntil: null });
  });

  it("a legitimate PIN works right after a wrong one while another account is being attacked", async () => {
    const attacked = await freshUser();
    const owner = await freshUser();
    const [, own] = await Promise.all([Promise.all(Array.from({ length: 30 }, () => verifyPin(attacked, WRONG))), verifyPin(owner, PIN)]);
    expect(own).toEqual({ ok: true });
  });
});
