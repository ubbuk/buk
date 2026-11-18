// «Цалин» табын API-уудын дундын хэсэг: оны параметр, 1С-ийн алдааг хариу болгох.
import { NextResponse } from "next/server";
import { currentYear } from "./dates";
import { OdataError } from "./odata-read";
import { payrollYears } from "./payroll-store";

export const NO_STORE = { "Cache-Control": "no-store" };

/** ?year=2026 (хоосон бол энэ он). Баазтай (ONEC_BASES, эсвэл энэ он) жил л зөвшөөрөгдөнө. */
export function parseYear(sp: URLSearchParams): { year: string } | { error: NextResponse } {
  const year = sp.get("year") ?? String(currentYear());
  if (!/^\d{4}$/.test(year) || !payrollYears().includes(year)) return { error: NextResponse.json({ error: "Энэ оны 1С бааз холбогдоогүй" }, { status: 400, headers: NO_STORE }) };
  return { year };
}

export function odataErrorResponse(e: unknown): NextResponse {
  if (e instanceof OdataError) return NextResponse.json({ error: e.message }, { status: e.status, headers: NO_STORE });
  throw e;
}
