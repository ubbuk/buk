// GET /api/onec-odata/objects — энэ дүрт харагдах 1С объектын жагсаалт ($metadata-аас). Зөвхөн унших.
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { canUseOdata, loadPolicy } from "@/lib/onec-odata/access";
import { OdataConfigError } from "@/lib/onec-odata/config";
import { OdataError } from "@/lib/onec-odata/client";
import { consumeRate } from "@/lib/onec-odata/limits";
import { loadViewer } from "@/lib/onec-odata/viewer";
import { listObjects } from "@/lib/onec-odata/service";

export const dynamic = "force-dynamic";
// 1С OData дуудлага бүр 30 сек хүртэл (lib/onec-odata/config.ts), Vercel-ийн анхдагч хязгаараас хамаарахгүй
export const maxDuration = 60;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });
  // Дүр, идэвхтэй эсэх, цалингийн эрхийг хүсэлт бүрд DB-ээс уншина (session-д кэшлэхгүй)
  const viewer = await loadViewer(session.user.id);
  if (!viewer) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });
  if (!canUseOdata(viewer.role)) return NextResponse.json({ error: "Энэ мэдээллийг үзэх эрхгүй" }, { status: 403 });

  const rate = consumeRate(session.user.id);
  if (!rate.ok) {
    return NextResponse.json({ error: "Хэт олон хүсэлт илгээлээ. Түр хүлээгээд дахин оролдоно уу" }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  }

  try {
    const objects = await listObjects(viewer, loadPolicy());
    return NextResponse.json({ objects });
  } catch (e) {
    if (e instanceof OdataError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof OdataConfigError) return NextResponse.json({ error: e.message }, { status: 503 });
    throw e;
  }
}
