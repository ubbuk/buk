"use client";

import { useState } from "react";
import { cn, formatNumber } from "@/lib/utils";
import { money } from "./FinanceShell";
import { RankBadge } from "./NgParts";
import { PAGE_SIZE, ShowMore, Toggle } from "./StockTree";

export interface RankedRow {
  key: string;
  name: string;
  /** нэрийн доорх мөр (тоо хэмжээ, нярав гэх мэт) */
  sub?: React.ReactNode;
  amount: number;
  /** хайлт энэ текстээс хайна (нэр, дэд мөрийн текст) */
  search: string;
}

/** Анхны (дүнгээр буурах) эрэмбийн дугаар: хайлт, хураалтад хамаарахгүй */
const TOP = 10;

function Row({ row, rank, share }: { row: RankedRow; rank: number; share: number }) {
  return (
    <li data-testid="ranked-row" className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1.5 border-t border-border/60 px-4 py-3 first:border-t-0">
      <RankBadge n={rank} />
      <div className="min-w-0">
        <p className="font-medium text-text [overflow-wrap:anywhere]">{row.name}</p>
        {row.sub && <p className="mt-0.5 text-xs text-text-muted">{row.sub}</p>}
      </div>
      <div className="text-right">
        <p className={cn("ng-num font-semibold", row.amount < 0 ? "text-danger" : "text-text")}>{money(row.amount)}</p>
        <p className="ng-num text-[11px] text-text-muted">{share.toFixed(1)}%</p>
      </div>
      {/* нийтийн хувь: баганын өргөн = хувь */}
      <div className="col-span-3 h-1.5 overflow-hidden rounded-full bg-white/5" role="img" aria-label={`Нийтийн ${share.toFixed(1)}%`}>
        <div className="h-full min-w-[2px] rounded-full bg-[linear-gradient(90deg,#f5b523,#ffd56b)]" style={{ width: `${Math.max(0, Math.min(100, share))}%` }} />
      </div>
    </li>
  );
}

/**
 * Дүнгээр эрэмбэлсэн мөрүүд: эхний 10, үлдсэн нь «Үлдсэн N (дүн)» гэсэн нэг хураасан мөр (задлахад PAGE_SIZE-аар).
 * Мөр бүрт нийтийн хувь, жижиг баганан график. `query` өгвөл БҮХ мөрөөс хайж, таарсныг (эрэмбийн дугаараа хадгалан) бүгдийг нь харуулна.
 * Хувь = мөрийн дүн / бүх мөрийн дүнгийн нийлбэр (хайлтад хамаарахгүй).
 */
export function RankedRows({ rows, query = "", emptyText = "Хайлтад тохирох мөр олдсонгүй" }: { rows: RankedRow[]; query?: string; emptyText?: string }) {
  const [restOpen, setRestOpen] = useState(false);
  const [shown, setShown] = useState(PAGE_SIZE);
  const ranked = [...rows].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, "mn")).map((r, i) => ({ r, rank: i + 1 }));
  const total = ranked.reduce((s, { r }) => s + r.amount, 0);
  const share = (amount: number) => (total > 0 ? (amount / total) * 100 : 0);
  const q = query.trim().toLowerCase();

  if (q) {
    const matches = ranked.filter(({ r }) => r.search.toLowerCase().includes(q));
    if (matches.length === 0) return <p className="px-4 py-10 text-center text-sm text-text-muted">{emptyText}</p>;
    return (
      <div data-testid="ranked-rows">
        <p className="border-b border-border/60 px-4 py-2 text-xs text-text-muted">
          Таарсан {formatNumber(matches.length, 0)} мөр ({formatNumber(rows.length, 0)}-аас)
        </p>
        <ul>
          {matches.slice(0, shown).map(({ r, rank }) => (
            <Row key={r.key} row={r} rank={rank} share={share(r.amount)} />
          ))}
        </ul>
        {matches.length > shown && <ShowMore remaining={matches.length - shown} onClick={() => setShown((n) => n + PAGE_SIZE)} />}
      </div>
    );
  }

  const top = ranked.slice(0, TOP);
  const rest = ranked.slice(TOP);
  const restAmount = rest.reduce((s, { r }) => s + r.amount, 0);
  return (
    <div data-testid="ranked-rows">
      <ul>
        {top.map(({ r, rank }) => (
          <Row key={r.key} row={r} rank={rank} share={share(r.amount)} />
        ))}
      </ul>
      {rest.length > 0 && (
        <div className="border-t border-border/60" data-testid="ranked-rest">
          <Toggle open={restOpen} onClick={() => setRestOpen((o) => !o)} controls="ranked-rest-rows" level={1}>
            <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-4">
              <span className="font-medium text-text">
                Үлдсэн {formatNumber(rest.length, 0)} <span className="ng-num font-normal text-text-muted">({money(restAmount)})</span>
              </span>
              <span className="ng-num ml-auto text-[11px] text-text-muted">{share(restAmount).toFixed(1)}%</span>
            </span>
          </Toggle>
          {restOpen && (
            <div id="ranked-rest-rows">
              <ul>
                {rest.slice(0, shown).map(({ r, rank }) => (
                  <Row key={r.key} row={r} rank={rank} share={share(r.amount)} />
                ))}
              </ul>
              {rest.length > shown && <ShowMore remaining={rest.length - shown} onClick={() => setShown((n) => n + PAGE_SIZE)} />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
