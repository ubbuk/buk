"use client";

import { ArrowDownRight, ArrowUpRight, FileText } from "lucide-react";
import { formatMoneyShort } from "@/lib/money-short";
import { PAYROLL_PART_ACCOUNT, type PayrollPartId, type PayrollPartView, type PayrollWent } from "@/lib/onec/payroll-view";
import { cn } from "@/lib/utils";
import { Amount } from "@/components/finance/cash/Amount";

export const PART_COLOR: Record<PayrollPartId, string> = {
  main: "#f472b6",
  benefit: "#fbbf24",
  sick: "#60a5fa",
  board: "#a78bfa",
  employerNdsh: "#34d399",
};

/** Зардал өссөн нь улаан, буурсан нь саарал (зөвхөн хувь, «өмнөх сараас») */
function Change({ pct, prev }: { pct: number | null; prev: number }) {
  if (pct === null || Math.abs(pct) < 0.5) return null;
  const up = pct > 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[11px]", up ? "text-danger" : "text-text-muted")} title={`Өмнөх сард ${Math.round(prev).toLocaleString("en-US")}₮ байсан`}>
      {up ? <ArrowUpRight className="size-3" aria-hidden /> : <ArrowDownRight className="size-3" aria-hidden />}
      {up ? "+" : ""}
      {pct.toFixed(0)}% өмнөх сараас
    </span>
  );
}

/** Юунд зарцуулсан бэ: үндсэн цалин, тэтгэмж, өвчний тэтгэмж, ТУЗ-ийн урамшуулал, ажил олгогчийн НДШ. Мөрийг дарвал нягтлангийн баримтууд (хамгийн доод түвшин). */
export function PayrollBreakdown({ parts, onDocs }: { parts: PayrollPartView[]; onDocs: (part: PayrollPartView) => void }) {
  const max = Math.max(1, ...parts.map((p) => p.amount));
  return (
    <div>
      <div className="border-b border-border p-4">
        <h3 className="text-sm font-semibold text-text">Юунд зарцуулсан бэ</h3>
      </div>
      <ul className="divide-y divide-border">
        {parts.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onDocs(p)}
              title={`Нягтланд: ${PAYROLL_PART_ACCOUNT[p.id]} данс · баримтуудыг харах`}
              className="focus-ring group flex min-h-14 w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left hover:bg-white/[0.03] sm:flex-nowrap"
            >
              <span className="min-w-0 flex-1 max-sm:basis-full">
                <span className="flex items-center gap-2 text-sm text-text">
                  <i className="size-2.5 shrink-0 rounded-full" style={{ background: PART_COLOR[p.id] }} aria-hidden />
                  <span className="min-w-0 truncate max-sm:whitespace-normal">{p.label}</span>
                  <span className="shrink-0 text-[11px] text-text-muted">{p.share.toFixed(1)}%</span>
                </span>
                <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-white/5" aria-hidden>
                  <span className="block h-full rounded-full" style={{ width: p.amount > 0 ? `${Math.max(2, (p.amount / max) * 100)}%` : 0, background: PART_COLOR[p.id] }} />
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-3 max-sm:w-full max-sm:justify-between">
                <Change pct={p.changePct} prev={p.prevAmount} />
                <Amount value={p.amount} className="text-sm font-semibold text-text" />
                <FileText className="size-3.5 shrink-0 text-[#ffd56b] opacity-60 group-hover:opacity-100" aria-hidden />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Хаашаа очсон: гарт олгосон, ХХОАТ, ажилтны НДШ, бусад суутгал. Бодолтгүй сард тайлбар. */
export function PayrollWentCard({ went }: { went: PayrollWent | null }) {
  const rows = went
    ? [
        { label: "Гарт олгосон", hint: `Банк ${formatMoneyShort(went.paidBank)} · Касс ${formatMoneyShort(went.paidCash)}`, value: went.paid },
        { label: "Татвар (ХХОАТ)", value: went.hhoat },
        { label: "Ажилтны НДШ", value: went.employeeNdsh },
        { label: "Бусад суутгал", value: went.other },
      ]
    : [];
  return (
    <div>
      <div className="border-b border-border p-4">
        <h3 className="text-sm font-semibold text-text">Хаашаа очсон бэ</h3>
      </div>
      {went ? (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.label} className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 px-4 py-2.5 text-sm">
              <span className="text-text">
                {r.label}
                {r.hint && <span className="ml-2 text-[11px] text-text-muted">{r.hint}</span>}
              </span>
              <Amount value={r.value} className="font-semibold text-text" />
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-8 text-center text-sm text-warning">Бодолт хараахан бүртгэгдээгүй</p>
      )}
    </div>
  );
}
