// Хөтчийн хэрэглэгчийн төлөв: дүр, идэвхтэй эсэх, canViewPayroll-ийг хүсэлт бүрд DB-ээс уншина.
// Session/JWT, process cache-д ХЭЗЭЭ Ч хадгалахгүй: ADMIN эрхийг хассан даруйд дараагийн хүсэлтээс хүчингүй болно.
import { prisma } from "@/lib/prisma";
import type { Viewer } from "./access";

export async function loadViewer(userId: string): Promise<Viewer | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, isActive: true, canViewPayroll: true } });
  if (!u || !u.isActive) return null;
  return { role: u.role, canViewPayroll: u.canViewPayroll };
}
