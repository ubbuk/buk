// ERP дотор хэн, хэзээ, ямар 1С объект үзсэнийг бүртгэнэ (1С талд бүх хандалт нэг техникийн хэрэглэгчээр харагддаг).
// Хайлтын текстийг (нэр, регистрийн дугаар зэрэг хувийн мэдээлэл байж болно) бүртгэхгүй: зөвхөн ашигласан эсэхийг тэмдэглэнэ.
import { clientIp } from "@/lib/client-ip";
import { prisma } from "@/lib/prisma";
import type { NormalizedQuery } from "./query";

export async function logOdataView(req: Request, actorId: string, object: string, q: NormalizedQuery) {
  await prisma.auditLog.create({
    data: {
      entityType: "OneCObject",
      entityId: object,
      action: "ONEC_ODATA_VIEW",
      actorId,
      afterJson: JSON.stringify({ page: q.page, pageSize: q.pageSize, dateFrom: q.dateFrom, dateTo: q.dateTo, code: !!q.code, search: !!q.q }),
      ipAddress: clientIp(req.headers),
    },
  });
}

export async function logOdataDenied(req: Request, actorId: string, role: string, object: string, reason: "role" | "object") {
  await prisma.auditLog.create({
    data: {
      entityType: "OneCObject",
      entityId: object,
      action: "ONEC_ODATA_DENIED",
      actorId,
      afterJson: JSON.stringify({ role, reason }),
      ipAddress: clientIp(req.headers),
    },
  });
}
