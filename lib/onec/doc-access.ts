// Баримтын жагсаалт, дэлгэрэнгүй, барааны түүхийн эрх: хэрэглэгчийг (дүр, цалингийн эрх) DB-ээс хүсэлт бүрд уншиж, doc-rules.ts-ийн дүрмээр шалгана.
// Клиентийн нуусан товчид найдахгүй: дүрмийг сервер дээр хүсэлт бүрд шалгана.
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { loadPolicy, type ObjectPolicy } from "@/lib/onec-odata/access";
import { OdataConfigError } from "@/lib/onec-odata/config";
import { loadViewer } from "@/lib/onec-odata/viewer";
import type { DocViewer } from "./doc-rules";
import { FINANCE_ROLES, STOREKEEPER_ROLE } from "./roles";

export { allowedKinds, canOpenDocument, canSeePostings, STOREKEEPER_KINDS, type DocViewer } from "./doc-rules";

export type DocAuth = { ok: true; viewer: DocViewer; policy: ObjectPolicy } | { ok: false; res: NextResponse };

/** Нэвтэрсэн, идэвхтэй хэрэглэгчийн дүр, цалингийн эрхийг (DB-ээс, session-д cache-лэхгүй) уншина. */
export async function requireDocViewer(): Promise<DocAuth> {
  const session = await getServerSession(authOptions);
  if (!session) return { ok: false, res: NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 }) };
  const viewer = await loadViewer(session.user.id);
  if (!viewer || (!FINANCE_ROLES.includes(viewer.role) && viewer.role !== STOREKEEPER_ROLE)) {
    return { ok: false, res: NextResponse.json({ error: "Энэ мэдээллийг үзэх эрхгүй" }, { status: 403 }) };
  }
  try {
    return { ok: true, viewer, policy: loadPolicy() };
  } catch (e) {
    if (e instanceof OdataConfigError) return { ok: false, res: NextResponse.json({ error: "1С-ийн эрхийн тохиргоо дутуу байна. Админд хандана уу" }, { status: 503 }) };
    throw e;
  }
}
