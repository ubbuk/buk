// «Үйлдвэрлэл» табын эрхийн хүрээ: ADMIN, DIRECTOR, ENGINEERING, CHIEF_ACCOUNTANT бүх цех; BOSS зөвхөн өөрийн цех (хэлтэс эсвэл тэргүүлдэг хэлтэс).
// ERP-ийн хэлтсийн нэрийг 1С-ийн «Подразделение»-ийн нэртэй жигдрүүлж тулгана (нэр ижил, эсвэл нэг нь нөгөөгөө агуулсан). Тохирохгүй бол юу ч харуулахгүй (алдаагаар олон өгөгдөл ил гаргахгүй).
import { prisma } from "@/lib/prisma";
import { normalizeDepartment } from "./production-names";
import type { ProductionScope } from "./production-view";

export const SCOPE_NOTE_NO_MATCH = "Таны хэлтэс үйлдвэрлэлийн цехтэй тохирохгүй байна. Админд хандаж цехээ тохируулна уу.";
const MIN_NAME = 4;

/** Цэвэр: ERP хэлтсийн нэрс ба 1С-ийн цехүүдийн нэрийг тулгаж зөвшөөрөгдсөн (жигдэрсэн) нэрсийг буцаана */
export function matchDepartments(erpNames: readonly string[], onecNames: readonly string[]): string[] {
  const erp = erpNames.map(normalizeDepartment).filter((n) => n.length >= MIN_NAME);
  const out = new Set<string>();
  for (const name of onecNames) {
    const n = normalizeDepartment(name);
    if (erp.some((e) => e === n || n.includes(e) || e.includes(n))) out.add(n);
  }
  return [...out];
}

export async function resolveProductionScope(userId: string, role: string, onecDepartments: readonly string[]): Promise<{ scope: ProductionScope; note: string | null }> {
  if (role !== "BOSS") return { scope: { departments: null }, note: null };
  const [own, headed] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { department: { select: { name: true } } } }),
    prisma.department.findMany({ where: { headId: userId, archivedAt: null }, select: { name: true } }),
  ]);
  const erp = [own?.department?.name, ...headed.map((d) => d.name)].filter((n): n is string => !!n);
  const allowed = matchDepartments(erp, onecDepartments);
  return { scope: { departments: allowed }, note: allowed.length ? null : SCOPE_NOTE_NO_MATCH };
}
