// «Мөнгөн хөрөнгө» табын «Данснууд»-ын тохиргоо (ЗӨВХӨН ADMIN): дансны нэр («Үндсэн данс»), нуух, дараалал. Зөвхөн харагдац: үлдэгдэл, гүйлгээнд нөлөөгүй.
// GET: одоо 1С-д байгаа мөнгөний дансууд (бүтэн дугаартай) + тохиргоо. PUT: тохиргоог хадгална (нэргүй, нуугаагүй, дараалалгүй мөр устгагдана). Аудитад бүртгэнэ.
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { authOptions } from "@/lib/auth";
import { loadCash } from "@/lib/onec/cash";
import { accountDescription, publicId } from "@/lib/onec/cash-accounts";
import { loadAccountSettings, MAX_NAME, saveAccountSettings } from "@/lib/onec/cash-accounts-store";
import { currentMonth } from "@/lib/onec/dates";
import { OdataError } from "@/lib/onec/odata-read";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!requireAdmin(session)) return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });
  try {
    const [{ value: cash }, settings] = await Promise.all([loadCash(currentMonth()), loadAccountSettings()]);
    return NextResponse.json({
      maxName: MAX_NAME,
      accounts: cash.accounts.map((a) => {
        const s = settings.get(a.key);
        return {
          key: a.key,
          id: publicId(a.key),
          description: accountDescription(a),
          number: a.number,
          currency: a.currency,
          kind: a.kind,
          closing: a.closing,
          name: s?.name ?? "",
          hidden: s?.hidden ?? false,
          sortOrder: s?.sortOrder ?? null,
        };
      }),
    });
  } catch (e) {
    if (e instanceof OdataError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

const bodySchema = z.object({
  items: z
    .array(
      z.object({
        key: z.string().regex(/^(bank:[0-9a-f-]{36}|acct:[0-9A-Za-z.]{1,12})$/, "Дансны түлхүүр буруу"),
        name: z.string().max(MAX_NAME, `Нэр ${MAX_NAME} тэмдэгтээс ихгүй`),
        hidden: z.boolean(),
        sortOrder: z.number().int().min(1).max(999).nullable(),
      })
    )
    .max(200),
});

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!requireAdmin(session)) return NextResponse.json({ error: "Эрхгүй үйлдэл" }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Хүчингүй өгөгдөл" }, { status: 400 });
  const result = await saveAccountSettings(parsed.data.items, session.user.id);
  return NextResponse.json(result);
}
