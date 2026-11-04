"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";
import { FLAG_LABEL, FLAG } from "@/lib/monitoring/history/codes";
import { cn } from "@/lib/utils";
import { formatDuration, formatUB, statusLabel, waitTone } from "../format";
import type { LoadState, ReconstructionView } from "./useTimeMachineApi";

const PAGE = 15;
const label = (s: string) => (s === "UNKNOWN" ? "Тодорхойгүй" : statusLabel(s));
const flagText = (f: string) => FLAG_LABEL[f as keyof typeof FLAG] ?? f;

// The reconstructed ERP state at the selected moment: completeness first, then
// statistics, the bottleneck, and the requests themselves.
export function HistoricalStatePanel({ state }: { state: LoadState<ReconstructionView> }) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [state]);

  if (state.status === "idle") {
    return (
      <section className="mh-card">
        <header className="mh-card-head">
          <h3>Сэргээсэн түүхэн төлөв</h3>
        </header>
        <p className="mh-empty">Time Machine-ээр цаг сонгоод «Сэргээх» товчийг дарна уу.</p>
      </section>
    );
  }
  if (state.status === "loading") {
    return (
      <section className="mh-card" aria-busy="true">
        <header className="mh-card-head">
          <h3>Сэргээсэн түүхэн төлөв</h3>
        </header>
        <p className="mh-empty">Audit log-оос түүхийг сэргээж байна…</p>
      </section>
    );
  }
  if (state.status === "error") {
    return (
      <section className="mh-card">
        <header className="mh-card-head">
          <h3>Сэргээсэн түүхэн төлөв</h3>
        </header>
        <p role="alert" className="mh-empty text-danger">
          {state.error}
        </p>
      </section>
    );
  }

  const d = state.data;
  const incomplete = d.completeness.status === "incomplete";
  const pages = Math.max(1, Math.ceil(d.requests.length / PAGE));
  const rows = d.requests.slice((page - 1) * PAGE, page * PAGE);
  const worst = d.summary.stages[0];

  return (
    <section className="mh-card" aria-label="Сэргээсэн түүхэн төлөв">
      <header className="mh-card-head">
        <h3>Сэргээсэн түүхэн төлөв</h3>
        <div className="ml-auto text-[11px] text-text-muted">
          {formatUB(d.asOf)} (УБ) · {d.engine.name} {d.engine.version} · {d.engine.kind === "wasm" ? "C++ / WASM" : "JS fallback"}
        </div>
      </header>

      <div className="space-y-4 p-4">
        <div className={cn("tm-verdict", incomplete && "is-incomplete")} role="status">
          {incomplete ? <AlertTriangle className="size-4 shrink-0" aria-hidden /> : <CheckCircle2 className="size-4 shrink-0" aria-hidden />}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text">{incomplete ? "Түүхийн сэргээлт бүрэн бус" : "Audit log-ийн хүрээнд бүрэн"}</p>
            {incomplete ? (
              <ul className="mt-1 list-inside list-disc text-xs text-text-muted">
                {d.completeness.reasons.map((r) => (
                  <li key={r.code}>
                    {r.message}: <b className="text-text">{r.count}</b>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-0.5 text-xs text-text-muted">Бүх захиалгын төлөв audit үйл явдлаар тайлбарлагдсан бөгөөд одоогийн төлөвтэй зөрөөгүй.</p>
            )}
            {d.completeness.notes.length > 0 && (
              <p className="mt-1 text-[11px] text-text-muted">
                Нэмэлт тэмдэглэл: {d.completeness.notes.map((n) => `${flagText(n.code)} (${n.count})`).join(", ")}
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Тухайн үед байсан захиалга" value={d.summary.existingRequests} />
          <Stat label="Батлалт хүлээж байсан" value={d.summary.pendingTotal} />
          <Stat label="Хэрэглэсэн үйл явдал" value={d.counters.applied} sub={`${d.counters.ignoredAfterAsOf} нь хожуу тул тооцоогүй`} />
          <Stat label="State hash" value={d.stateHash.slice(0, 8)} mono />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {Object.entries(d.summary.byStatus).map(([s, n]) => (
            <span key={s} className={cn("tm-chip", s === "UNKNOWN" && "is-unknown")}>
              {label(s)} <b>{n}</b>
            </span>
          ))}
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium text-text">Шат бүрийн хүлээлт ба гацаа</p>
          {d.summary.stages.length === 0 ? (
            <p className="text-xs text-text-muted">Тэр мөчид батлалт хүлээж байсан захиалга алга.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-xs">
                <thead className="text-left text-text-muted">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Шат</th>
                    <th className="py-1 pr-3 text-right font-medium">Тоо</th>
                    <th className="py-1 pr-3 text-right font-medium">Дундаж</th>
                    <th className="py-1 pr-3 text-right font-medium">Медиан</th>
                    <th className="py-1 text-right font-medium">Хамгийн удаан</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {d.summary.stages.map((st) => (
                    <tr key={st.status} className={cn(st === worst && "tm-bottleneck")}>
                      <td className="py-1.5 pr-3">
                        {label(st.status)}
                        {st === worst && <span className="ml-2 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent">гацаа</span>}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{st.count}</td>
                      <td className={cn("py-1.5 pr-3 text-right tabular-nums", waitTone(st.avgSeconds))}>{formatDuration(st.avgSeconds)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{formatDuration(st.medianSeconds)}</td>
                      <td className={cn("py-1.5 text-right tabular-nums", waitTone(st.maxSeconds))}>{formatDuration(st.maxSeconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium text-text">
            Захиалгууд ({d.requests.length}
            {d.requestsTotal > d.requests.length ? ` / ${d.requestsTotal}, хамгийн удаан хүлээсэн нь эхэнд` : ""})
          </p>
          {rows.length === 0 ? (
            <p className="text-xs text-text-muted">Тэр мөчид захиалга байгаагүй.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-xs">
                <thead className="text-left text-text-muted">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Дугаар</th>
                    <th className="py-1 pr-3 font-medium">Хэлтэс</th>
                    <th className="py-1 pr-3 font-medium">Төлөв (сэргээсэн)</th>
                    <th className="py-1 pr-3 font-medium">Энэ төлөвт орсон</th>
                    <th className="py-1 pr-3 text-right font-medium">Хүлээсэн</th>
                    <th className="py-1 font-medium">Тэмдэглэгээ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {rows.map((r) => (
                    <tr key={r.id} className={cn(r.status === "UNKNOWN" && "tm-row-unknown")}>
                      <td className="py-1.5 pr-3 font-medium">№{r.requestNumber}</td>
                      <td className="py-1.5 pr-3">{r.department}</td>
                      <td className="py-1.5 pr-3">{label(r.status)}</td>
                      <td className="whitespace-nowrap py-1.5 pr-3 text-text-muted">{r.since ? formatUB(r.since) : "—"}</td>
                      <td className={cn("whitespace-nowrap py-1.5 pr-3 text-right tabular-nums", r.waitingSeconds != null && waitTone(r.waitingSeconds))}>
                        {r.waitingSeconds != null ? formatDuration(r.waitingSeconds) : "—"}
                      </td>
                      <td className="py-1.5 text-[11px] text-text-muted">{r.flags.length ? r.flags.map(flagText).join(", ") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pages > 1 && (
            <div className="mt-2 flex items-center justify-end gap-2 text-xs text-text-muted">
              <button type="button" className="tm-btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                ‹
              </button>
              <span>
                {page} / {pages}
              </span>
              <button type="button" className="tm-btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                ›
              </button>
            </div>
          )}
        </div>

        <ul className="list-inside list-disc space-y-0.5 border-t border-border/60 pt-3 text-[11px] text-text-muted">
          {d.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Stat({ label: l, value, sub, mono }: { label: string; value: number | string; sub?: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-border/60 bg-bg/40 px-3 py-2">
      <p className="text-[10.5px] text-text-muted">{l}</p>
      <p className={cn("text-lg font-semibold tabular-nums text-text", mono && "font-mono text-sm")}>{value}</p>
      {sub && <p className="text-[10px] text-text-muted">{sub}</p>}
    </div>
  );
}
