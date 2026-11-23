"use client";

import { useState } from "react";
import { FileText, Hourglass, Percent, Receipt, Users } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { DailyBarChart } from "@/components/finance/DailyBarChart";
import { ErrorNote, FinanceShell, connectionFrom } from "@/components/finance/FinanceShell";
import { FinanceKpi as KpiCard } from "@/components/finance/NgParts";
import { Amount } from "@/components/finance/cash/Amount";
import { DocumentList } from "@/components/finance/docs/DocumentList";
import { AGING_COLOR, ReceivablesLists, type AgingKey } from "@/components/finance/receivables/ReceivablesLists";
import { useFinanceData } from "@/components/finance/useFinanceData";
import { MonthRefreshNote, RefreshButton, useMonthRefresh } from "@/components/finance/useOnecRefresh";
import { MissingMonth } from "@/components/finance/YearSection";
import { useIsAdmin, useYm } from "@/components/finance/useYm";
import { formatMoneyFull, formatMoneyShort } from "@/lib/money-short";
import { addDays } from "@/lib/onec/dates";
import type { ReceivablesResult } from "@/lib/onec/receivables";
import type { AgingTotals } from "@/lib/onec/receivable-aging";
import type { CustomerView, PreviousComparison } from "@/lib/onec/receivables-view";
import { formatNumber } from "@/lib/utils";

// Postgres-ийн агшин зургаас шууд; агшин зураг байхгүй бол missing
interface Snapshot extends Omit<ReceivablesResult, "customers"> {
  missing: false;
  customers: CustomerView[];
  aging: AgingTotals & { method: "fifo"; historyStart: string | null };
  previous: PreviousComparison | null;
  trend: { month: string; asOf: string; receivable: number }[];
}
type ReceivablesResponse = (Snapshot | { missing: true; asOf: string }) & { refreshing: boolean; lastAttemptOk: boolean | null; lastSyncedAt: string | null };

const MN_MONTH = (ym: string) => `${ym.slice(0, 4)} оны ${Number(ym.slice(5, 7))}-р сар`;

export default function ReceivablesPage() {
  const { ym, isCurrent } = useYm();
  const isAdmin = useIsAdmin();
  const [bucket, setBucket] = useState<AgingKey | null>(null);
  // Хамгийн доод drill-down: харилцагчийн борлуулалт, банкны орлого (сүүлийн 100 хоног) → баримтын drawer
  const [docs, setDocs] = useState<CustomerView | null>(null);
  const { data, error, reload } = useFinanceData<ReceivablesResponse>(`/api/dashboard/receivables?month=${ym}`);
  // Хуудас 1С-ийг хүлээхгүй: агшин зургийг Postgres-оос шууд харуулна. Одоогийн сар 5 минутаас илүү хуучирсан бол ар талд шинэчилнэ;
  // өнгөрсөн сарыг зөвхөн админ татна (сервер мөн шалгана).
  const sync = useMonthRefresh(ym, reload, "receivables");
  const canRefresh = isCurrent || isAdmin;
  const snap = data && !data.missing ? data : null;
  const waiting = data?.missing && (sync.busy || data.refreshing);
  const prev = snap?.previous ?? null;
  const over30Share = snap && snap.totals.receivable > 0 ? (snap.aging.over30 / snap.totals.receivable) * 100 : null;
  const maxBucket = Math.max(1, ...(snap?.aging.buckets.map((b) => b.amount) ?? [1]));

  return (
    <FinanceShell
      title="Авлага"
      subtitle={`Худалдан авагчаас авах авлага${data ? ` · ${data.asOf}-ны үлдэгдэл` : ""}`}
      icon={Receipt}
      lastSyncedAt={data?.lastSyncedAt}
      connection={connectionFrom(data?.lastSyncedAt, sync.phase === "failed" || sync.phase === "error")}
      notice={<MonthRefreshNote phase={sync.phase} retryAt={sync.retryAt} />}
      refresh={canRefresh ? <RefreshButton busy={sync.busy} retryAt={sync.retryAt} onClick={sync.refresh} /> : undefined}
    >
      {error && <ErrorNote message={error} />}

      {data?.missing && !waiting ? (
        <MissingMonth subject="Энэ өдрийн авлагын мэдээлэл хараахан татагдаагүй" busy={sync.busy} onLoad={sync.refresh} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {!snap ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)
            ) : (
              <>
                <KpiCard
                  featured
                  label="Нийт авлага"
                  value={<Amount value={snap.totals.receivable} />}
                  valueText={formatMoneyShort(snap.totals.receivable)}
                  icon={Receipt}
                  tone="accent"
                  delta={prev?.changePct ?? undefined}
                  deltaCostLike
                  hint={prev ? `Өмнөх сарын эцэстэй (${prev.asOf}) харьцуулахад ${prev.change >= 0 ? "+" : "−"}${formatMoneyShort(Math.abs(prev.change))}` : "Өмнөх сарын мэдээлэл татагдаагүй"}
                />
                <KpiCard label="Өртэй харилцагч" value={formatNumber(snap.totals.debtors, 0)} icon={Users} hint={`Нийт ${formatNumber(snap.totals.customers, 0)} харилцагчаас`} />
                <KpiCard
                  label="30 хоногоос дээш хуучирсан"
                  value={<Amount value={snap.aging.over30} />}
                  valueText={formatMoneyShort(snap.aging.over30)}
                  icon={Hourglass}
                  tone={snap.aging.over30 > 0 ? "warning" : "neutral"}
                  hint={over30Share === null ? undefined : `Нийт авлагын ${over30Share.toFixed(0)}%`}
                />
                <KpiCard label="Урьдчилж төлсөн" value={<Amount value={snap.totals.credit} />} valueText={formatMoneyShort(snap.totals.credit)} icon={Percent} hint={snap.totals.vat ? `НӨАТ-ын авлага ${formatMoneyShort(snap.totals.vat)} тусдаа` : "Кредит үлдэгдэлтэй харилцагчид"} />
              </>
            )}
          </div>

          <div className="grid gap-5 lg:grid-cols-5">
            <Card className="min-w-0 lg:col-span-2">
              <CardHeader>
                <CardTitle>Авлага хэр хуучирсан бэ</CardTitle>
              </CardHeader>
              <CardBody className="space-y-2">
                {snap ? (
                  <>
                    {snap.aging.buckets.map((b) =>
                      b.key === "unknown" && b.amount === 0 ? null : (
                        <button
                          key={b.key}
                          type="button"
                          onClick={() => setBucket(bucket === b.key ? null : (b.key as AgingKey))}
                          aria-pressed={bucket === b.key}
                          className={`focus-ring w-full rounded-xl border p-3 text-left transition-colors hover:bg-white/[0.04] ${bucket === b.key ? "border-[rgba(255,213,107,0.6)] bg-white/[0.05]" : "border-transparent"}`}
                        >
                          <span className="flex items-baseline justify-between gap-3">
                            <span className="flex items-center gap-2 text-sm text-text">
                              <i className="size-2.5 rounded-full" style={{ background: AGING_COLOR[b.key as AgingKey] }} aria-hidden />
                              {b.label}
                            </span>
                            <Amount value={b.amount} className="text-sm font-semibold text-text" />
                          </span>
                          <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-white/5">
                            <span className="block h-full rounded-full" style={{ width: `${Math.max(2, (b.amount / maxBucket) * 100)}%`, background: AGING_COLOR[b.key as AgingKey] }} />
                          </span>
                          <span className="mt-1 block text-[11px] text-text-muted">{b.customers} харилцагч</span>
                        </button>
                      )
                    )}
                    <p className="px-1 pt-1 text-[11px] leading-snug text-text-muted">
                      Төлбөрийн хугацаа 1С-д хадгалагддаггүй тул нас нь өр үүссэн (борлуулсан) огнооноос хойших хоногоор, төлбөр хамгийн хуучин борлуулалтыг эхэлж хаана гэж үзэж тооцсон.
                      {snap.aging.buckets.find((b) => b.key === "unknown")!.amount > 0 && " «Нас тодорхойгүй» нь борлуулалтын баримт олдоогүй (өөр төрлийн авлага) өр."}
                    </p>
                  </>
                ) : (
                  <Skeleton className="h-56" />
                )}
              </CardBody>
            </Card>

            <Card className="min-w-0 lg:col-span-3">
              <CardHeader>
                <CardTitle>{ym.slice(0, 4)} оны сар бүрийн эцсийн авлага</CardTitle>
              </CardHeader>
              <CardBody>
                {snap ? (
                  snap.trend.length > 1 ? (
                    <DailyBarChart
                      data={snap.trend.map((t) => ({ date: t.month, receivable: t.receivable }))}
                      series={[{ key: "receivable", label: "Авлага", color: "rgb(var(--color-accent))" }]}
                      label={(m) => `${Number(m.slice(5, 7))}`}
                      tooltipTitle={MN_MONTH}
                      unit="сараар"
                    />
                  ) : (
                    <p className="py-10 text-center text-sm text-text-muted">Сар бүрийн эцсийн мэдээлэл хараахан цугларсангүй</p>
                  )
                ) : (
                  <Skeleton className="h-56" />
                )}
              </CardBody>
            </Card>
          </div>

          <Card>{snap ? <ReceivablesLists customers={snap.customers} bucket={bucket} onBucket={setBucket} onDocs={(c) => {
            setDocs(c);
            requestAnimationFrame(() => document.getElementById("receivable-documents")?.scrollIntoView({ behavior: "smooth", block: "start" }));
          }} /> : <Skeleton className="m-4 h-64" />}</Card>

          {snap && docs && docs.key && (
            <div id="receivable-documents" className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <FileText className="size-4 text-[#ffd56b]" aria-hidden />
                <span className="font-medium text-text">{docs.name}</span>
                <span className="text-text-muted">· {formatMoneyFull(docs.balance)}</span>
                <button type="button" onClick={() => setDocs(null)} className="focus-ring min-h-9 rounded-lg px-2 text-xs text-text-muted hover:text-text">
                  Хаах
                </button>
              </div>
              <DocumentList
                key={docs.key}
                url={`/api/dashboard/documents?from=${addDays(snap.asOf, -99)}&to=${snap.asOf}&kinds=sale,bank_in&party=${docs.key}`}
                title="Борлуулалт, банкны орлого (сүүлийн 100 хоног)"
                money
                hideWarehouseFilter
                emptyDescription="Сүүлийн 100 хоногт энэ харилцагчийн баримт олдсонгүй."
              />
            </div>
          )}
        </>
      )}
    </FinanceShell>
  );
}
