// GET /api/onec-odata/data?object=<нэр>&page=&pageSize=&dateFrom=&dateTo=&code=&q=
// 1С-ийн нэг объектыг унших. Зөвхөн GET. Хэрэглэгчийн query string 1С руу дамжихгүй: объектын нэр $metadata-аар
// баталгаажиж, URL-ийг сервер өөрөө бүтээнэ (lib/onec-odata/query.ts).
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { canUseOdata, loadPolicy } from "@/lib/onec-odata/access";
import { logOdataDenied, logOdataView } from "@/lib/onec-odata/audit";
import { OdataError } from "@/lib/onec-odata/client";
import { OdataConfigError } from "@/lib/onec-odata/config";
import { consumeRate } from "@/lib/onec-odata/limits";
import { normalizeQuery, QueryError } from "@/lib/onec-odata/query";
import { queryObject, resolveObject } from "@/lib/onec-odata/service";
import { loadViewer } from "@/lib/onec-odata/viewer";

export const dynamic = "force-dynamic";
// 1С OData дуудлага бүр 30 сек хүртэл (lib/onec-odata/config.ts), Vercel-ийн анхдагч хязгаараас хамаарахгүй
export const maxDuration = 60;

const int = (v: string | null) => (v !== null && /^\d{1,6}$/.test(v) ? Number(v) : undefined);

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });
  const userId = session.user.id;
  // Дүр, идэвхтэй эсэх, цалингийн эрхийг хүсэлт бүрд DB-ээс уншина (session/JWT-д кэшлэхгүй)
  const viewer = await loadViewer(userId);
  if (!viewer) return NextResponse.json({ error: "Нэвтрээгүй байна" }, { status: 401 });
  const role = viewer.role;
  const sp = new URL(req.url).searchParams;
  const object = (sp.get("object") ?? "").slice(0, 200);

  if (!canUseOdata(role)) {
    await logOdataDenied(req, userId, role, object || "-", "role").catch(() => {});
    return NextResponse.json({ error: "Энэ мэдээллийг үзэх эрхгүй" }, { status: 403 });
  }

  const rate = consumeRate(userId);
  if (!rate.ok) {
    return NextResponse.json({ error: "Хэт олон хүсэлт илгээлээ. Түр хүлээгээд дахин оролдоно уу" }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  }
  if (!object) return NextResponse.json({ error: "Объект сонгоно уу" }, { status: 400 });

  try {
    const policy = loadPolicy();
    let entity;
    try {
      entity = await resolveObject(viewer, policy, object);
    } catch (e) {
      if (e instanceof OdataError && e.status === 403) await logOdataDenied(req, userId, role, object, "object").catch(() => {});
      throw e;
    }

    // Зөвхөн энд нэрлэсэн параметрүүдийг уншина; бусад бүх параметрийг үл тооно
    const input = {
      page: int(sp.get("page")),
      pageSize: int(sp.get("pageSize")),
      dateFrom: sp.get("dateFrom") ?? undefined,
      dateTo: sp.get("dateTo") ?? undefined,
      code: sp.get("code") ?? undefined,
      q: sp.get("q") ?? undefined,
    };

    let normalized;
    try {
      normalized = normalizeQuery(entity, input);
    } catch (e) {
      if (e instanceof QueryError) throw new OdataError(400, e.message);
      throw e;
    }

    // Бүртгэл амжилтгүй бол өгөгдөл өгөхгүй (fail-closed): хэн юу үзснийг заавал мэдэх ёстой
    try {
      await logOdataView(req, userId, entity.name, normalized);
    } catch {
      return NextResponse.json({ error: "Хандалтыг бүртгэж чадсангүй. Дахин оролдоно уу" }, { status: 503 });
    }

    const { cached, ...page } = await queryObject(viewer, policy, entity, input);
    return NextResponse.json({ ...page, cached });
  } catch (e) {
    if (e instanceof OdataError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof OdataConfigError) return NextResponse.json({ error: e.message }, { status: 503 });
    throw e;
  }
}
