import bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { authorizeGrant, announce, recordGrant, type GrantContext } from "./authority-grant";
import { POSITION_REQUIRED_ROLE } from "./authority-roles";
import { emitBroadcast } from "./events";
import { lockExecutivePosition, validateNewExecutive } from "./executive-handover";
import { isProcurementPosition, POSITION_KIND, validateProcurementManager } from "./procurement-handover";
import { lockPositionExclusive, pendingClassificationRequestIds, unfinishedAssignedItems } from "./procurement-workload";
import { verifyAccountPassword } from "./pin-management";
import { sessionRevocation } from "./session-revocation";

// Removing a user from the admin screen, in one reviewed step.
//
// What the person is responsible for is read first (approval positions, department head, warehouse keeper, the approval steps
// waiting on them, unfinished procurement items) and the ADMIN decides, per responsibility, who takes it over or that it stays
// EMPTY (explicitly: a missing answer is refused). On confirmation, with the administrator's own password, ONE transaction:
//   1. moves each responsibility (position holder, department head, warehouse keeper) to the chosen person,
//   2. re-points the waiting approval steps and the unfinished procurement items to the new people (with notifications),
//   3. removes the account: a person without history is deleted for good; a person WITH history (an audit entry, a decided
//      approval, a request ...) is marked deleted (deletedAt), cannot sign in, loses sessions / PIN / recovery tokens, has the
//      e-mail released for re-use, and stays in the records under their name so nobody's past decisions are lost.
// Whether there is history: references that the database would silently BLANK on a hard delete (an approval step's assignee or
// decider, a voided purchase, a deferred-approval decision, a chosen foreign-trade quote) count as history first (otherwise "who
// decided" would be erased); every other reference is refused by its foreign key, so the hard delete is attempted behind a SAVEPOINT
// and, when refused, rolled back to the soft delete. Everything is audited; nothing is written when any step fails.

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

export const POSITION_LABEL: Record<string, string> = {
  ENGINEERING_CHIEF: "Ерөнхий инженер (Үйлдвэрийн чиглэл)",
  OPERATIONS_DIRECTOR: "Үйл ажиллагаа эрхэлсэн захирал (Оффисын чиглэл)",
  FINANCE_DIRECTOR: "Санхүү эрхэлсэн захирал",
  EXECUTIVE_DIRECTOR: "Гүйцэтгэх захирал",
  STOREKEEPER_LEAD: "Нярав",
  CHIEF_ACCOUNTANT_LEAD: "Ерөнхий нягтлан бодогч",
  DOMESTIC_PROCUREMENT_MANAGER: "Дотоодын худалдан авалтын менежер",
  INTERNATIONAL_PROCUREMENT_MANAGER: "Олон улсын худалдан авалтын менежер",
};

/** Requests in these states have nothing left to approve: a pending step on them is not work to hand over. */
const FINISHED = ["DRAFT", "COMPLETED", "PARTIALLY_COMPLETED", "CANCELLED", "ACCOUNTING_COMPLETED", "PENDING_ACCOUNTING"] as const;

export type RemovalFailure = { ok: false; status: number; error: string; code?: string; retryAfterSeconds?: number };
const fail = (status: number, error: string, code?: string, retryAfterSeconds?: number): RemovalFailure => ({ ok: false, status, error, code, retryAfterSeconds });
class Abort extends Error {
  constructor(readonly failure: RemovalFailure) {
    super(failure.error);
  }
}

export interface Candidate {
  id: string;
  name: string;
}
export type ResponsibilityKind = "POSITION" | "DEPARTMENT_HEAD" | "WAREHOUSE_KEEPER";
export interface Responsibility {
  /** `position:<POSITION>`, `head:<departmentId>`, `keeper:<warehouseId>`: the key of the answer */
  key: string;
  kind: ResponsibilityKind;
  title: string;
  /** unfinished procurement items (procurement positions) */
  items: number;
  /** International manager: requests waiting to be classified (they follow the position) */
  classification: number;
  candidates: Candidate[];
}
export interface RemovalInspection {
  user: { id: string; name: string; email: string; role: string; isActive: boolean };
  responsibilities: Responsibility[];
  pending: { requests: number; executiveRequests: number; candidates: Candidate[] };
  /** unfinished procurement items of kinds the person does not hold the position for: nobody takes them over */
  strayItems: number;
}

const byName = (a: Candidate, b: Candidate) => a.name.localeCompare(b.name, "mn");

async function usersWithRole(db: Db, role: string, excludeId: string): Promise<Candidate[]> {
  const rows = await db.user.findMany({ where: { role: role as never, isActive: true, deletedAt: null, id: { not: excludeId } }, select: { id: true, name: true } });
  return rows.sort(byName);
}

async function positionCandidates(db: Db, position: string, excludeId: string): Promise<Candidate[]> {
  const list = await usersWithRole(db, POSITION_REQUIRED_ROLE[position], excludeId);
  if (!isProcurementPosition(position)) return list;
  const valid: Candidate[] = [];
  for (const c of list) if (!(await validateProcurementManager(db, position, c.id))) valid.push(c);
  return valid;
}

async function pendingSteps(db: Db, userId: string) {
  return db.approvalStep.findMany({
    where: {
      assignedUserId: userId,
      OR: [
        { status: "PENDING", request: { status: { notIn: [...FINISHED] } } },
        // approved by the executive but the quantities may still be deferred (same rule as the executive handover)
        { type: "EXECUTIVE_APPROVAL", status: "APPROVED", request: { status: "PENDING_PROCUREMENT" } },
      ],
    },
    select: { id: true, type: true, status: true, requestId: true, request: { select: { requestNumber: true, departmentId: true, status: true } } },
    orderBy: { id: "asc" },
  });
}

/** Read-only: everything the person is responsible for and who may take each part over. */
export async function inspectRemoval(userId: string, db: Db = prisma): Promise<RemovalInspection | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, role: true, isActive: true, deletedAt: true } });
  if (!user || user.deletedAt) return null;

  const [positions, departments, warehouses, steps, allItems] = await Promise.all([
    db.approvalRoleAssignment.findMany({ where: { userId, isActive: true }, select: { role: true } }),
    db.department.findMany({ where: { headId: userId }, select: { id: true, name: true } }),
    db.warehouse.findMany({ where: { keeperId: userId }, select: { id: true, name: true } }),
    pendingSteps(db, userId),
    unfinishedAssignedItems(db, { managerId: userId }),
  ]);

  const responsibilities: Responsibility[] = [];
  const heldKinds = new Set<string>();
  for (const p of positions) {
    const kind = isProcurementPosition(p.role) ? POSITION_KIND[p.role] : null;
    if (kind) heldKinds.add(kind);
    responsibilities.push({
      key: `position:${p.role}`,
      kind: "POSITION",
      title: POSITION_LABEL[p.role] ?? p.role,
      items: kind ? allItems.filter((i) => i.kind === kind).length : 0,
      classification: p.role === "INTERNATIONAL_PROCUREMENT_MANAGER" ? (await pendingClassificationRequestIds(db)).length : 0,
      candidates: await positionCandidates(db, p.role, userId),
    });
  }
  if (departments.length > 0) {
    const heads = await usersWithRole(db, "BOSS", userId);
    for (const d of departments) responsibilities.push({ key: `head:${d.id}`, kind: "DEPARTMENT_HEAD", title: `Цехийн дарга: ${d.name}`, items: 0, classification: 0, candidates: heads });
  }
  if (warehouses.length > 0) {
    const keepers = await usersWithRole(db, "STOREKEEPER", userId);
    for (const w of warehouses) responsibilities.push({ key: `keeper:${w.id}`, kind: "WAREHOUSE_KEEPER", title: `Нярав: ${w.name}`, items: 0, classification: 0, candidates: keepers });
  }

  return {
    user: { id: user.id, name: user.name, email: user.email, role: user.role, isActive: user.isActive },
    responsibilities,
    pending: {
      requests: new Set(steps.map((s) => s.requestId)).size,
      executiveRequests: new Set(steps.filter((s) => s.type === "EXECUTIVE_APPROVAL").map((s) => s.requestId)).size,
      candidates: steps.length > 0 ? await usersWithRole(db, user.role, userId) : [],
    },
    strayItems: allItems.filter((i) => !heldKinds.has(i.kind)).length,
  };
}

export interface RemovalInput {
  adminId: string;
  adminPassword: string;
  targetId: string;
  ip: string | null;
  /** answer per responsibility key: a user id (take over) or null (leave empty). A missing key is refused. */
  transfers: Record<string, string | null>;
  /** who takes the waiting approval steps that no specific answer covers */
  pendingReceiverId?: string | null;
}

export interface RemovalSummary {
  mode: "HARD" | "SOFT";
  moved: { responsibilities: number; emptied: number; approvalSteps: number; procurementItems: number };
}

/** An unusable credential: random, never disclosed, so the account cannot be signed into even if it were re-activated by mistake. */
async function unusablePasswordHash(): Promise<string> {
  return bcrypt.hash(randomBytes(32).toString("hex"), 10);
}

export const releasedEmail = (userId: string) => `deleted+${userId}@deleted.invalid`;

/** References whose foreign key is ON DELETE SET NULL: a hard delete would not fail, it would erase who decided / was responsible. */
async function hasBlankableHistory(tx: Tx, userId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ n: number }[]>`
    SELECT (SELECT count(*) FROM "ApprovalStep" WHERE "assignedUserId" = ${userId} OR "decidedById" = ${userId})
         + (SELECT count(*) FROM "ProcurementPurchase" WHERE "voidedById" = ${userId})
         + (SELECT count(*) FROM "DeferredApprovalRequest" WHERE "decidedById" = ${userId})
         + (SELECT count(*) FROM "ForeignTradeOrder" WHERE "selectedById" = ${userId}) AS n`;
  return Number(rows[0]?.n ?? 0) > 0;
}

function isForeignKeyBlock(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError) return e.code === "P2003";
  return e instanceof Prisma.PrismaClientUnknownRequestError && /violates (RESTRICT setting of )?foreign key/i.test(e.message);
}

export async function removeUser(input: RemovalInput): Promise<RemovalFailure | { ok: true; summary: RemovalSummary }> {
  if (!input.adminPassword) return fail(400, "Админы нууц үгээ оруулна уу", "PASSWORD_REQUIRED");
  if (input.targetId === input.adminId) return fail(400, "Өөрийгөө устгах боломжгүй", "SELF_DELETE");

  const admin = await prisma.user.findUnique({ where: { id: input.adminId }, select: { role: true, isActive: true } });
  if (!admin || !admin.isActive || admin.role !== "ADMIN") return fail(403, "Эрхгүй үйлдэл");
  const target = await prisma.user.findUnique({ where: { id: input.targetId }, select: { id: true, name: true, email: true, role: true, isActive: true, deletedAt: true } });
  if (!target || target.deletedAt) return fail(404, "Хэрэглэгч олдсонгүй");
  if (target.role === "ADMIN") return fail(409, "Админ эрхтэй хэрэглэгчийг устгах боломжгүй", "ADMIN_PROTECTED");

  // the administrator's own password, throttled (the same budget as the other current-password checks)
  const denied = await verifyAccountPassword(input.adminId, input.adminPassword, input.ip);
  if (denied) return { ok: false, status: denied.status, error: denied.error, code: denied.status === 401 ? "WRONG_PASSWORD" : undefined, retryAfterSeconds: denied.retryAfterSeconds };

  // the answers must cover every responsibility, explicitly; every chosen person must be eligible NOW (re-checked under the locks below)
  const preview = await inspectRemoval(input.targetId);
  if (!preview) return fail(404, "Хэрэглэгч олдсонгүй");
  for (const r of preview.responsibilities) {
    if (!(r.key in input.transfers)) return fail(400, `«${r.title}»: шилжүүлэх хүнийг сонгох эсвэл «хоосон үлдээх»-ийг сонгоно уу`, "ANSWER_MISSING");
  }
  const unknown = Object.keys(input.transfers).find((k) => !preview.responsibilities.some((r) => r.key === k));
  if (unknown) return fail(409, "Хариуцлага урьдчилан харснаас өөрчлөгдсөн байна. Цонхыг дахин нээгээд шалгана уу", "WORK_CHANGED");

  // one grant context per person who receives authority (position / head / keeper): the same audit trail and notifications as a normal appointment
  const grants = new Map<string, GrantContext>();
  for (const [key, receiver] of Object.entries(input.transfers)) {
    if (!receiver) continue;
    const kind = key.startsWith("position:") ? (isProcurementPosition(key.slice(9)) ? "PROCUREMENT_POSITION" : "POSITION_ASSIGNMENT") : key.startsWith("head:") ? "DEPARTMENT_HEAD" : "WAREHOUSE_KEEPER";
    const authorised = await authorizeGrant({ adminId: input.adminId, stepUp: { reason: `${target.name} системээс хасагдсан тул шилжүүлэв` }, kind, targetUserId: receiver, ip: input.ip, checkCustody: true });
    if (!authorised.ok) return { ok: false, status: authorised.status, error: authorised.error, code: authorised.code };
    grants.set(key, authorised.grant);
  }
  const passwordHash = await unusablePasswordHash();

  const notify: string[] = [];
  try {
    const summary = await prisma.$transaction(
      async (tx) => {
        // serialised with the position changes / handovers that can race this one
        await lockExecutivePosition(tx);
        for (const r of preview.responsibilities) if (r.kind === "POSITION" && isProcurementPosition(r.key.slice(9))) await lockPositionExclusive(tx, r.key.slice(9) as never);

        const now = await inspectRemoval(input.targetId, tx);
        if (!now) throw new Abort(fail(404, "Хэрэглэгч олдсонгүй"));
        if (JSON.stringify(now.responsibilities.map((r) => r.key)) !== JSON.stringify(preview.responsibilities.map((r) => r.key))) {
          throw new Abort(fail(409, "Хариуцлага урьдчилан харснаас өөрчлөгдсөн байна. Цонхыг дахин нээгээд шалгана уу", "WORK_CHANGED"));
        }

        let moved = 0;
        let emptied = 0;
        let procurementItems = 0;
        const receiverOfPosition = new Map<string, string>();

        for (const r of now.responsibilities) {
          const receiver = input.transfers[r.key];
          if (receiver && !r.candidates.some((c) => c.id === receiver)) throw new Abort(fail(400, `«${r.title}»: сонгосон хүн энэ хариуцлагыг авах боломжгүй байна`, "RECEIVER_INELIGIBLE"));
          const grant = receiver ? grants.get(r.key) : undefined;
          if (!receiver) emptied++;
          else moved++;
          const [type, id] = [r.key.split(":")[0], r.key.slice(r.key.indexOf(":") + 1)];

          if (type === "position") {
            const holders = await tx.approvalRoleAssignment.findMany({ where: { role: id as never, isActive: true }, select: { userId: true } });
            await tx.approvalRoleAssignment.updateMany({ where: { role: id as never, isActive: true }, data: { isActive: false, endedAt: new Date() } });
            if (receiver) {
              await tx.approvalRoleAssignment.create({ data: { role: id as never, userId: receiver, isActive: true } });
              receiverOfPosition.set(id, receiver);
            }
            await tx.auditLog.create({
              data: { entityType: "ApprovalRoleAssignment", entityId: receiver ?? input.targetId, action: "UPDATE", actorId: input.adminId, beforeJson: JSON.stringify({ position: id, holders: holders.map((h) => h.userId) }), afterJson: JSON.stringify({ position: id, holders: receiver ? [receiver] : [], reason: "user-removal" }) },
            });
            if (receiver && grant) notify.push(...(await recordGrant(tx, grant, { subjectType: "ApprovalRoleAssignment", subjectId: id, summary: `${target.name}-ийн «${POSITION_LABEL[id] ?? id}» албан тушаал ${await nameOf(tx, receiver)}-д шилжлээ`, before: { position: id, holders: holders.map((h) => h.userId) }, after: { position: id, holders: [receiver] }, previousHolderIds: [] })));
            // unfinished procurement work follows the position
            if (receiver && isProcurementPosition(id)) {
              const items = await unfinishedAssignedItems(tx, { kind: POSITION_KIND[id], managerId: input.targetId });
              if (items.length > 0) {
                const upd = await tx.procurementItemAssignment.updateMany({ where: { requestItemId: { in: items.map((i) => i.itemId) }, kind: POSITION_KIND[id], assignedManagerId: input.targetId }, data: { assignedManagerId: receiver, assignedAt: new Date() } });
                if (upd.count !== items.length) throw new Abort(fail(409, "Хуваарилалт зэрэг өөрчлөгдсөн тул устгал цуцлагдлаа. Дахин оролдоно уу", "WORK_CHANGED"));
                procurementItems += items.length;
                await tx.auditLog.createMany({
                  data: items.map((i) => ({ entityType: "ProcurementItemAssignment", entityId: i.itemId, action: "PROCUREMENT_REASSIGN" as const, actorId: input.adminId, beforeJson: JSON.stringify({ assignedManagerId: input.targetId }), afterJson: JSON.stringify({ assignedManagerId: receiver, requestId: i.requestId, reason: "user-removal", remainingQuantity: i.remaining, purchasedQuantityPreserved: i.purchased }) })),
                });
                await tx.notification.create({ data: { userId: receiver, type: "PROCUREMENT_REQUIRED", title: "Худалдан авалтын ажил шилжиж ирлээ", body: `${items.length} дуусаагүй материал танд шилжлээ` } });
                notify.push(receiver);
              }
            }
          } else if (type === "head") {
            const dept = await tx.department.findUnique({ where: { id }, select: { name: true, headId: true } });
            if (dept?.headId !== input.targetId) throw new Abort(fail(409, "Хариуцлага зэрэг өөрчлөгдсөн байна. Дахин оролдоно уу", "WORK_CHANGED"));
            await tx.department.update({ where: { id }, data: { headId: receiver } });
            await tx.auditLog.create({ data: { entityType: "Department", entityId: id, action: "UPDATE", actorId: input.adminId, beforeJson: JSON.stringify({ headId: input.targetId }), afterJson: JSON.stringify({ headId: receiver, reason: "user-removal" }) } });
            if (receiver && grant) notify.push(...(await recordGrant(tx, grant, { subjectType: "Department", subjectId: id, summary: `«${dept.name}» цехийн даргаар томилогдлоо`, before: { headId: input.targetId }, after: { headId: receiver } })));
          } else {
            const wh = await tx.warehouse.findUnique({ where: { id }, select: { name: true, keeperId: true } });
            if (wh?.keeperId !== input.targetId) throw new Abort(fail(409, "Хариуцлага зэрэг өөрчлөгдсөн байна. Дахин оролдоно уу", "WORK_CHANGED"));
            await tx.warehouse.update({ where: { id }, data: { keeperId: receiver } });
            await tx.auditLog.create({ data: { entityType: "Warehouse", entityId: id, action: "UPDATE", actorId: input.adminId, beforeJson: JSON.stringify({ keeperId: input.targetId }), afterJson: JSON.stringify({ keeperId: receiver, reason: "user-removal" }) } });
            if (receiver && grant) notify.push(...(await recordGrant(tx, grant, { subjectType: "Warehouse", subjectId: id, summary: `«${wh.name}» агуулахын нярваар томилогдлоо`, before: { keeperId: input.targetId }, after: { keeperId: receiver } })));
          }
        }

        // the waiting approval steps (read after the responsibilities moved, under row locks)
        const steps = await pendingSteps(tx, input.targetId);
        if (steps.length > 0) {
          await tx.$queryRaw`SELECT id FROM "ApprovalStep" WHERE id = ANY(${steps.map((s) => s.id)}::text[]) ORDER BY id FOR UPDATE`;
          const headReceiver = (departmentId: string) => input.transfers[`head:${departmentId}`] ?? null;
          const executive = receiverOfPosition.get("EXECUTIVE_DIRECTOR") ?? null;
          const general = input.pendingReceiverId ?? null;
          if (general && !now.pending.candidates.some((c) => c.id === general)) throw new Abort(fail(400, "Хүлээгдэж буй захиалгыг авах хүн тохирохгүй байна", "RECEIVER_INELIGIBLE"));
          const receiverFor = (s: (typeof steps)[number]): string | null => (s.type === "EXECUTIVE_APPROVAL" ? executive : s.type === "DEPARTMENT_HEAD" ? headReceiver(s.request.departmentId) ?? general : general);
          const missing = steps.filter((s) => !receiverFor(s));
          if (missing.length > 0) {
            const exec = missing.some((s) => s.type === "EXECUTIVE_APPROVAL");
            throw new Abort(fail(400, exec ? "Гүйцэтгэх захирлын хүлээгдэж буй баталгааг зөвхөн «Гүйцэтгэх захирал» албан тушаалын шинэ эзэнд шилжүүлнэ. Тэр албан тушаалд хүн сонгоно уу" : "Хүлээгдэж буй захиалгыг хэнд шилжүүлэхээ сонгоно уу", exec ? "EXECUTIVE_RECEIVER_REQUIRED" : "PENDING_RECEIVER_REQUIRED"));
          }
          if (executive && steps.some((s) => s.type === "EXECUTIVE_APPROVAL")) {
            const invalid = await validateNewExecutive(tx, executive);
            if (invalid) throw new Abort(fail(invalid.status, invalid.error, invalid.code));
          }
          const key = `user-removal:${input.targetId}`;
          for (const s of steps) {
            const to = receiverFor(s)!;
            const upd = await tx.approvalStep.updateMany({ where: { id: s.id, assignedUserId: input.targetId }, data: { assignedUserId: to } });
            if (upd.count !== 1) throw new Abort(fail(409, "Хуваарилалт зэрэг өөрчлөгдсөн тул устгал цуцлагдлаа. Дахин оролдоно уу", "WORK_CHANGED"));
            if (s.type === "EXECUTIVE_APPROVAL") {
              await tx.executiveApprovalReassignment.create({ data: { handoverKey: key, requestId: s.requestId, fromUserId: input.targetId, toUserId: to, reassignedById: input.adminId, reason: "Хэрэглэгч системээс хасагдсан", stepStatusBefore: s.status, requestStatusBefore: s.request.status } });
            }
            await tx.auditLog.create({ data: { entityType: "ApprovalStep", entityId: s.id, action: "UPDATE", actorId: input.adminId, beforeJson: JSON.stringify({ assignedUserId: input.targetId }), afterJson: JSON.stringify({ assignedUserId: to, requestId: s.requestId, reason: "user-removal" }) } });
          }
          await tx.notification.createMany({ data: steps.map((s) => ({ userId: receiverFor(s)!, type: "APPROVAL_REQUIRED" as const, title: "Захиалгын баталгаа танд шилжлээ", body: `№${s.request.requestNumber} захиалгыг хянана уу`, relatedRequestId: s.requestId })) });
          for (const s of steps) notify.push(receiverFor(s)!);
        }

        // the account itself
        await tx.notification.deleteMany({ where: { userId: input.targetId } });
        await tx.passwordRecoveryToken.deleteMany({ where: { userId: input.targetId } });
        await tx.approvalPinCredential.deleteMany({ where: { userId: input.targetId } });
        await tx.approvalRoleAssignment.updateMany({ where: { userId: input.targetId, isActive: true }, data: { isActive: false, endedAt: new Date() } });

        let mode: "HARD" | "SOFT" = "HARD";
        const softDelete = async () => {
          mode = "SOFT";
          await tx.user.update({
            where: { id: input.targetId },
            data: { deletedAt: new Date(), isActive: false, email: releasedEmail(input.targetId), passwordHash, canViewPayroll: false, passwordChangedAt: new Date(), ...sessionRevocation() },
          });
        };
        if (await hasBlankableHistory(tx, input.targetId)) {
          await softDelete();
        } else {
          await tx.$executeRaw`SAVEPOINT user_hard_delete`;
          try {
            await tx.approvalRoleAssignment.deleteMany({ where: { userId: input.targetId } });
            await tx.user.delete({ where: { id: input.targetId } });
            await tx.$executeRaw`RELEASE SAVEPOINT user_hard_delete`;
          } catch (e) {
            if (!isForeignKeyBlock(e)) throw e;
            await tx.$executeRaw`ROLLBACK TO SAVEPOINT user_hard_delete`;
            await softDelete();
          }
        }

        // never a password or a hash: who, what mode, what moved. The old address is kept here (and only here) so the removal can be traced.
        await tx.auditLog.create({
          data: {
            entityType: "User",
            entityId: input.targetId,
            action: "UPDATE_USER",
            actorId: input.adminId,
            ipAddress: input.ip,
            beforeJson: JSON.stringify({ name: target.name, email: target.email, role: target.role, isActive: target.isActive }),
            afterJson: JSON.stringify({ kind: "USER_DELETE", mode, responsibilities: Object.fromEntries(Object.entries(input.transfers)), pendingReceiverId: input.pendingReceiverId ?? null, movedApprovalSteps: steps.length, movedProcurementItems: procurementItems }),
          },
        });
        return { mode, moved: { responsibilities: moved, emptied, approvalSteps: steps.length, procurementItems } } satisfies RemovalSummary;
      },
      { timeout: 30_000, maxWait: 10_000 }
    );

    announce([...new Set(notify)]);
    emitBroadcast({ type: "request-changed" });
    emitBroadcast({ type: "data-changed" });
    return { ok: true, summary };
  } catch (e) {
    if (e instanceof Abort) return e.failure;
    console.error(JSON.stringify({ route: "removeUser", failed: e instanceof Prisma.PrismaClientKnownRequestError ? e.code : e instanceof Error ? e.name : "unknown" }));
    return fail(500, "Устгах үед алдаа гарлаа. Юу ч өөрчлөгдөөгүй, дахин оролдоно уу", "FAILED");
  }
}

async function nameOf(db: Db, id: string): Promise<string> {
  return (await db.user.findUnique({ where: { id }, select: { name: true } }))?.name ?? "хэрэглэгч";
}
