import bcrypt from "bcrypt";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "./prisma";
import { verifyPin } from "./pin";
import { PIN_FORMAT_ERROR, isValidPinFormat } from "./pin-format";
import { needsApprovalPin } from "./pin-need";
import { resetPinAsAdmin, setOwnPin } from "./pin-management";
import { serializeStep } from "./serialize";

// A manager (any role that decides with a PIN) must be able to set one: who is asked for a PIN, the 4-6 digit format,
// the "set a PIN first" answer, an admin reset forcing a new PIN, and how the pool (price review) step is named.
const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("next-auth", () => ({ getServerSession: async () => session.current }));

import { GET as PIN_GET, POST as PIN_POST } from "@/app/api/me/pin/route";

const P = "ps-";
const TAG = Date.now().toString(36);
const PASSWORD = "Account-pw-1";
const ADMIN_PASSWORD = "Admin-pw-1";
let hash = "";
let adminHash = "";
let n = 0;
const created: string[] = [];
const depts: string[] = [];
const ip = () => `10.77.${Math.floor(++n / 250)}.${n % 250}`;

async function user(role: "EMPLOYEE" | "MANAGER" | "BOSS" | "DIRECTOR" | "ADMIN" = "EMPLOYEE", opts: { active?: boolean } = {}) {
  const id = `${P}${TAG}-${++n}`;
  await prisma.user.create({ data: { id, email: `${id}@test.local`, name: id, role, passwordHash: role === "ADMIN" ? adminHash : hash, isActive: opts.active ?? true } });
  created.push(id);
  return id;
}
const as = (id: string, role = "EMPLOYEE") => {
  session.current = { user: { id, role, name: id, email: `${id}@test.local` } };
};
const post = (body: unknown) => PIN_POST(new Request("http://localhost/api/me/pin", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": ip() }, body: JSON.stringify(body) }));
const get = async () => (await PIN_GET()).json() as Promise<{ hasPin: boolean; needsPin: boolean }>;

beforeAll(async () => {
  vi.stubEnv("TRUSTED_PROXY", "hops:1");
  hash = await bcrypt.hash(PASSWORD, 4);
  adminHash = await bcrypt.hash(ADMIN_PASSWORD, 4);
  await prisma.loginThrottle.deleteMany();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await prisma.loginThrottle.deleteMany();
  await prisma.approvalRoleAssignment.deleteMany({ where: { userId: { in: created } } });
  await prisma.department.deleteMany({ where: { id: { in: depts } } });
  await prisma.notification.deleteMany({ where: { userId: { in: created } } });
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: created } }, { entityId: { in: created } }] } });
  await prisma.approvalPinCredential.deleteMany({ where: { userId: { in: created } } });
  await prisma.user.deleteMany({ where: { id: { in: created } } });
});

describe("who is asked for a PIN", () => {
  it("the MANAGER role (the price review has no single assignee) needs one, so does an approver role", async () => {
    expect(await needsApprovalPin(await user("MANAGER"))).toBe(true);
    expect(await needsApprovalPin(await user("BOSS"))).toBe(true);
    expect(await needsApprovalPin(await user("DIRECTOR"))).toBe(true);
  });

  it("a plain employee does not, until an approval position or a department makes them a decider", async () => {
    const e = await user("EMPLOYEE");
    expect(await needsApprovalPin(e)).toBe(false);
    await prisma.approvalRoleAssignment.create({ data: { role: "FINANCE_DIRECTOR", userId: e, isActive: true } });
    expect(await needsApprovalPin(e)).toBe(true);

    const head = await user("EMPLOYEE");
    const d = await prisma.department.create({ data: { name: `${P}${TAG}-d`, type: "FACTORY", headId: head } });
    depts.push(d.id);
    expect(await needsApprovalPin(head)).toBe(true);
    expect(await needsApprovalPin(await user("MANAGER", { active: false }))).toBe(false);
  });

  it("GET /api/me/pin reports hasPin and needsPin", async () => {
    const m = await user("MANAGER");
    as(m, "MANAGER");
    expect(await get()).toEqual({ hasPin: false, needsPin: true });
    expect((await post({ pin: "4821", confirmPin: "4821", currentPassword: PASSWORD })).status).toBe(200);
    expect(await get()).toEqual({ hasPin: true, needsPin: true });
    const e = await user("EMPLOYEE");
    as(e);
    expect(await get()).toEqual({ hasPin: false, needsPin: false });
  });
});

describe("PIN format: 4 to 6 digits", () => {
  it("accepts 4, 5 and 6 digits; refuses 3, 7, letters, spaces and full-width digits", () => {
    for (const ok of ["1234", "12345", "123456", "0000"]) expect(isValidPinFormat(ok), ok).toBe(true);
    for (const bad of ["123", "1234567", "abcd", "12 4", "", "１２３４", "12.45"]) expect(isValidPinFormat(bad), bad).toBe(false);
  });

  it("a manager sets a 6-digit PIN with the password and approves with it; the 4-digit message is gone", async () => {
    const m = await user("MANAGER");
    as(m, "MANAGER");
    const bad = await post({ pin: "123", confirmPin: "123", currentPassword: PASSWORD });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe(PIN_FORMAT_ERROR);
    expect((await post({ pin: "123456", confirmPin: "123456", currentPassword: "nope" })).status).toBe(401);
    expect((await post({ pin: "123456", confirmPin: "654321", currentPassword: PASSWORD })).status).toBe(400);
    expect((await post({ pin: "123456", confirmPin: "123456", currentPassword: PASSWORD })).status).toBe(200);
    expect(await verifyPin(m, "123456")).toEqual({ ok: true });
    expect(await verifyPin(m, "1234")).toMatchObject({ ok: false, status: 401 });
  });

  it("a PIN set while it was exactly 4 digits still works", async () => {
    const m = await user("MANAGER");
    expect(await setOwnPin({ userId: m, currentPassword: PASSWORD, pin: "2468", ip: ip() })).toEqual({ ok: true, created: true });
    expect(await verifyPin(m, "2468")).toEqual({ ok: true });
  });
});

describe("no PIN yet / admin reset", () => {
  it("approving without a PIN says to set one first (the modal turns that into a link to /settings)", async () => {
    const m = await user("MANAGER");
    const r = await verifyPin(m, "1234");
    expect(r).toMatchObject({ ok: false, status: 400, error: "Эхлээд PIN тохируулна уу" });
  });

  it("after an admin reset the user has no PIN, is asked for one again, and can set a new one with their password", async () => {
    const admin = await user("ADMIN");
    const m = await user("MANAGER");
    await setOwnPin({ userId: m, currentPassword: PASSWORD, pin: "1357", ip: ip() });
    const r = await resetPinAsAdmin({ adminId: admin, adminPassword: ADMIN_PASSWORD, targetUserId: m, reason: "Ажилтан PIN-ээ мартсан", identityVerified: true, ip: ip() });
    expect(r).toEqual({ ok: true, hadPin: true });
    as(m, "MANAGER");
    expect(await get()).toEqual({ hasPin: false, needsPin: true }); // the banner and the settings card ask again
    expect(await verifyPin(m, "1357")).toMatchObject({ ok: false, status: 400 });
    expect((await post({ pin: "97531", confirmPin: "97531", currentPassword: PASSWORD })).status).toBe(200);
    expect(await verifyPin(m, "97531")).toEqual({ ok: true });
  });
});

describe("naming the price-review step", () => {
  const step = (type: "MANAGER_PRICING" | "BRANCH_APPROVAL" | "MANAGER_PROCUREMENT", status: "PENDING" | "APPROVED", decider?: string) =>
    serializeStep({
      type,
      status,
      assignedUserId: null,
      decidedAt: status === "APPROVED" ? new Date() : null,
      comment: null,
      assignedUser: null,
      actions: decider ? [{ documentHash: "h", actor: { role: "MANAGER", name: decider } }] : [],
    } as never);

  it("pending: any manager (not a bare dash); decided: the manager who decided", () => {
    expect(step("MANAGER_PRICING", "PENDING").assignedUserName).toBe("Аль ч менежер");
    expect(step("MANAGER_PRICING", "APPROVED", "boroo").assignedUserName).toBe("boroo");
    expect(step("MANAGER_PROCUREMENT", "PENDING").assignedUserName).toBe("Аль ч менежер");
  });

  it("a step that should have a person but has none still shows a dash", () => {
    expect(step("BRANCH_APPROVAL", "PENDING").assignedUserName).toBe("—");
  });
});
