import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { invalidate } from "./cache";
import { emitBroadcast } from "./events";
import { verifyAccountPassword } from "./pin-management";

// Administrator department management: rename / change type, and remove.
//
// Removing is decided by the history of the department, not by a flag the admin sets:
//  - members (users) must be moved first (another department or none): the admin has to answer, nothing is chosen for them;
//  - a department that has request history (or foreign-trade orders, or former members that were deleted) is ARCHIVED: hidden
//    from every list, not selectable for users or new requests, its history stays untouched. It is refused while undecided
//    requests are still in flight (nobody could finish them);
//  - a department with no history at all is deleted for good.
// Removal needs the administrator's own password (throttled) and is audited; the move and the removal are one transaction.

type Tx = Prisma.TransactionClient;

export type DepartmentFailure = { ok: false; status: number; error: string; code?: string; retryAfterSeconds?: number };
const fail = (status: number, error: string, code?: string, retryAfterSeconds?: number): DepartmentFailure => ({ ok: false, status, error, code, retryAfterSeconds });
class Abort extends Error {
  constructor(readonly failure: DepartmentFailure) {
    super(failure.error);
  }
}

/** Requests in these states are finished: nothing waits on anybody. */
const FINISHED = ["DRAFT", "COMPLETED", "PARTIALLY_COMPLETED", "CANCELLED", "ACCOUNTING_COMPLETED"] as const;

export interface DepartmentInspection {
  department: { id: string; name: string; type: "OFFICE" | "FACTORY"; headName: string | null };
  members: number;
  requests: number;
  /** requests still in flight: the department cannot be archived while there are any */
  openRequests: number;
  /** anything that keeps the history of the department (requests, orders, deleted former members): it will be archived, not erased */
  hasHistory: boolean;
  /** other departments the members can move to */
  targets: { id: string; name: string; type: "OFFICE" | "FACTORY" }[];
}

export async function inspectDepartment(id: string, db: Tx | typeof prisma = prisma): Promise<DepartmentInspection | null> {
  const d = await db.department.findFirst({ where: { id, archivedAt: null }, include: { head: { select: { name: true } } } });
  if (!d) return null;
  const [members, requests, openRequests, orders, formerMembers, targets] = await Promise.all([
    db.user.count({ where: { departmentId: id, deletedAt: null } }),
    db.materialRequest.count({ where: { departmentId: id } }),
    db.materialRequest.count({ where: { departmentId: id, status: { notIn: [...FINISHED] } } }),
    db.foreignTradeOrder.count({ where: { departmentId: id } }),
    db.user.count({ where: { departmentId: id, deletedAt: { not: null } } }),
    db.department.findMany({ where: { archivedAt: null, id: { not: id } }, select: { id: true, name: true, type: true }, orderBy: { name: "asc" } }),
  ]);
  return { department: { id: d.id, name: d.name, type: d.type, headName: d.head?.name ?? null }, members, requests, openRequests, hasHistory: requests + orders + formerMembers > 0, targets };
}

async function adminOk(adminId: string): Promise<boolean> {
  const a = await prisma.user.findUnique({ where: { id: adminId }, select: { role: true, isActive: true } });
  return !!a && a.isActive && a.role === "ADMIN";
}

export async function createDepartment(input: { adminId: string; name: string; type: "OFFICE" | "FACTORY" }) {
  const name = input.name.trim();
  if (!(await adminOk(input.adminId))) return fail(403, "Эрхгүй үйлдэл");
  if (await prisma.department.findFirst({ where: { name, archivedAt: null } })) return fail(409, "Энэ нэртэй цех, тасаг бүртгэлтэй байна");
  const department = await prisma.department.create({ data: { name, type: input.type } });
  await prisma.auditLog.create({ data: { entityType: "Department", entityId: department.id, action: "CREATE", actorId: input.adminId, afterJson: JSON.stringify({ name, type: input.type }) } });
  invalidate("departments:list");
  emitBroadcast({ type: "data-changed" });
  return { ok: true as const, department };
}

export async function updateDepartment(input: { adminId: string; id: string; name?: string; type?: "OFFICE" | "FACTORY" }) {
  if (!(await adminOk(input.adminId))) return fail(403, "Эрхгүй үйлдэл");
  const current = await prisma.department.findFirst({ where: { id: input.id, archivedAt: null } });
  if (!current) return fail(404, "Цех, тасаг олдсонгүй");
  const name = input.name?.trim();
  if (name !== undefined && name !== current.name && (await prisma.department.findFirst({ where: { name, archivedAt: null, id: { not: input.id } } }))) return fail(409, "Энэ нэртэй цех, тасаг бүртгэлтэй байна");
  const next = { name: name ?? current.name, type: input.type ?? current.type };
  if (next.name === current.name && next.type === current.type) return { ok: true as const, department: current, changed: false };
  const department = await prisma.$transaction(async (tx) => {
    const row = await tx.department.update({ where: { id: input.id }, data: next });
    await tx.auditLog.create({ data: { entityType: "Department", entityId: input.id, action: "UPDATE", actorId: input.adminId, beforeJson: JSON.stringify({ name: current.name, type: current.type }), afterJson: JSON.stringify(next) } });
    return row;
  });
  invalidate("departments:list");
  emitBroadcast({ type: "data-changed" });
  return { ok: true as const, department, changed: true };
}

export interface RemoveDepartmentInput {
  adminId: string;
  adminPassword: string;
  id: string;
  ip: string | null;
  /** where the members go: a department id, or null for no department. Required when there are members. */
  moveTo?: string | null;
}

export async function removeDepartment(input: RemoveDepartmentInput): Promise<DepartmentFailure | { ok: true; mode: "DELETED" | "ARCHIVED"; moved: number }> {
  if (!input.adminPassword) return fail(400, "Админы нууц үгээ оруулна уу", "PASSWORD_REQUIRED");
  if (!(await adminOk(input.adminId))) return fail(403, "Эрхгүй үйлдэл");
  const pre = await inspectDepartment(input.id);
  if (!pre) return fail(404, "Цех, тасаг олдсонгүй");
  if (pre.members > 0 && input.moveTo === undefined) return fail(400, "Энэ цехийн хэрэглэгчдийг хаана шилжүүлэхээ сонгоно уу (өөр цех эсвэл цехгүй)", "MOVE_REQUIRED");
  if (pre.openRequests > 0) return fail(409, `Дуусаагүй ${pre.openRequests} захиалга байгаа тул цехийг устгах, архивлах боломжгүй. Эхлээд захиалгуудыг дуусгах эсвэл цуцлана уу`, "OPEN_REQUESTS");

  const denied = await verifyAccountPassword(input.adminId, input.adminPassword, input.ip);
  if (denied) return { ok: false, status: denied.status, error: denied.error, code: denied.status === 401 ? "WRONG_PASSWORD" : undefined, retryAfterSeconds: denied.retryAfterSeconds };

  try {
    const result = await prisma.$transaction(async (tx) => {
      const now = await inspectDepartment(input.id, tx);
      if (!now) throw new Abort(fail(404, "Цех, тасаг олдсонгүй"));
      if (now.openRequests > 0) throw new Abort(fail(409, `Дуусаагүй ${now.openRequests} захиалга байгаа тул цехийг устгах, архивлах боломжгүй`, "OPEN_REQUESTS"));
      if (input.moveTo && !now.targets.some((t) => t.id === input.moveTo)) throw new Abort(fail(400, "Шилжүүлэх цех олдсонгүй эсвэл архивлагдсан байна", "TARGET_INVALID"));
      if (now.members > 0 && input.moveTo === undefined) throw new Abort(fail(400, "Хэрэглэгчдийг хаана шилжүүлэхээ сонгоно уу", "MOVE_REQUIRED"));

      const moved = await tx.user.updateMany({ where: { departmentId: input.id, deletedAt: null }, data: { departmentId: input.moveTo ?? null } });
      await tx.department.update({ where: { id: input.id }, data: { headId: null } });

      let mode: "DELETED" | "ARCHIVED" = "ARCHIVED";
      if (now.hasHistory) {
        await tx.department.update({ where: { id: input.id }, data: { archivedAt: new Date() } });
      } else {
        await tx.department.delete({ where: { id: input.id } });
        mode = "DELETED";
      }
      await tx.auditLog.create({
        data: {
          entityType: "Department",
          entityId: input.id,
          action: "UPDATE",
          actorId: input.adminId,
          ipAddress: input.ip,
          beforeJson: JSON.stringify({ name: now.department.name, type: now.department.type, head: now.department.headName }),
          afterJson: JSON.stringify({ kind: "DEPARTMENT_REMOVE", mode, movedMembers: moved.count, movedTo: input.moveTo ?? null, requests: now.requests }),
        },
      });
      return { mode, moved: moved.count };
    });
    invalidate("departments:list");
    emitBroadcast({ type: "data-changed" });
    return { ok: true, ...result };
  } catch (e) {
    if (e instanceof Abort) return e.failure;
    console.error(JSON.stringify({ route: "removeDepartment", failed: e instanceof Prisma.PrismaClientKnownRequestError ? e.code : e instanceof Error ? e.name : "unknown" }));
    return fail(500, "Устгах үед алдаа гарлаа. Юу ч өөрчлөгдөөгүй, дахин оролдоно уу", "FAILED");
  }
}
