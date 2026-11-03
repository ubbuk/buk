import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { emitBroadcast } from "./events";

type MaterialResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

/**
 * Registers a brand-new Material catalog row. ADMIN-only (the role that
 * used to also allow this, CLERK_INVENTORY, no longer exists in the 8-role
 * system) — see app/api/materials/route.ts's role gate.
 */
export async function registerMaterial(
  actorId: string,
  input: { code: string; name: string; unit: string; category?: string; defaultPrice: number }
): Promise<MaterialResult<{ id: string }>> {
  const existing = await prisma.material.findUnique({ where: { code: input.code } });
  if (existing) return { ok: false, status: 409, error: "Энэ код бүхий материал бүртгэлтэй байна" };

  const material = await prisma.material.create({
    data: {
      code: input.code,
      name: input.name,
      unit: input.unit,
      category: input.category,
      defaultPrice: new Prisma.Decimal(input.defaultPrice),
    },
  });
  await prisma.auditLog.create({
    data: { entityType: "Material", entityId: material.id, action: "CREATE", actorId },
  });
  emitBroadcast({ type: "request-changed" });
  return { ok: true, data: { id: material.id } };
}
