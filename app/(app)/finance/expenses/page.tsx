"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, BarChart3, FileText, Receipt, Trophy } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { DailyBarChart } from "@/components/finance/DailyBarChart";
import { ErrorNote, FinanceShell, connectionFrom } from "@/components/finance/FinanceShell";
import { FinanceKpi as KpiCard } from "@/components/finance/NgParts";
import { Amount } from "@/components/finance/cash/Amount";
import { DocumentList } from "@/components/finance/docs/DocumentList";
import { CATEGORY_COLOR, ExpenseCategories } from "@/components/finance/expenses/ExpenseCategories";
import { useFinanceData } from "@/components/finance/useFinanceData";
import { MonthRefreshNote, RefreshButton, useMonthRefresh } from "@/components/finance/useOnecRefresh";
import { MissingMonth, YearSection } from "@/components/finance/YearSection";
import { useIsAdmin, useYm } from "@/components/finance/useYm";
import { formatMoneyShort } from "@/lib/money-short";
import type { ExpenseItemView, ExpenseView } from "@/lib/onec/expense-view";
import { cn } from "@/lib/utils";

// Зардал нь зөвхөн P&L-ийг ашиглана
const EXPENSE_KINDS = ["pl"] as const;
type ExpensesResponse = ExpenseView & { empty: boolean; lastSyncedAt: string | null };

const MN_MONTH = (ym: string) => `${ym.slice(0, 4)} оны ${Number(ym.slice(5, 7))}-р сар`;

export default function ExpensesPage() {
  const { ym: month, isCurrent, view, year } = useYm();
  const isAdmin = useIsAdmin();
  // Графикт харуулах ангилал (null = нийт үйл ажиллагааны зардал)
  const [series, setSeries] = useState<string | null>(null);
  // Хамгийн доод drill-down: зардлын нэр -> нягтлангийн баримтууд -> баримтын drawer
  const [docs, setDocs] = useState<ExpenseItemView | null>(null);
  const { data, error, reload } = useFinanceData<ExpensesResponse>(view === "month" ? `/api/dashboard/expenses/report?month=${month}` : null);
  // Postgres-ээс шууд; 5 минутаас илүү хуучирсан бол ар талд 1С-ээс татаж, дуусмагц дахин ачаална
  const sync = useMonthRefresh(month, reload, "month", EXPENSE_KINDS);
  const canRefresh = isCurrent || isAdmin; // өнгөрсөн сарыг зөвхөн админ татна

  const cat = data?.categories.find((c) => c.id === series) ?? null;
  const chart = useMemo(() => (data ? data.months.map((m, i) => ({ date: m.month, value: cat ? cat.series[i] : m.total })) : []), [data, cat]);
  const missing = useMemo(() => (data ? data.months.filter((m) => !m.loaded).map((m) => `${Number(m.month.slice(5, 7))}-р сар`) : []), [data]);

  return (
    <FinanceShell
      title="Зардал"
      subtitle="Юунд хэдийг зарцуулсан бэ: ангиллаар, өмнөх сартай харьцуулан"
      icon={BarChart3}
      withView
      lastSyncedAt={data?.lastSyncedAt}
      connection={connectionFrom(data?.lastSyncedAt, sync.phase === "failed" || sync.phase === "error")}
      notice={view === "month" ? <MonthRefreshNote phase={sync.phase} retryAt={sync.retryAt} /> : undefined}
      refresh={view === "month" && canRefresh ? <RefreshButton busy={sync.busy} retryAt={sync.retryAt} onClick={sync.refresh} /> : undefined}
    >
      {view === "year" ? (
        <YearSection tab="expenses" year={year} label="зардал" />
      ) : (
        <>
          {error && <ErrorNote message={error} />}

          {data?.empty ? (
            <MissingMonth busy={sync.busy} onLoad={sync.refresh} />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {!data ? (
                  Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)
                ) : (
                  <>
                    <KpiCard
                      featured
                      spark={data.months.map((m) => m.total)}
                      label="Нийт үйл ажиллагааны зардал"
                      value={<Amount value={data.total} />}
                      valueText={formatMoneyShort(data.total)}
                      icon={Receipt}
                      tone="accent"
                      delta={data.changePct}
                      deltaCostLike
                      hint={data.prevLoaded ? "Өмнөх сараас" : "Өмнөх сар татагдаагүй"}
                    />
                    <KpiCard
                      label={`Өмнөх сар (${Number(data.prevMonth.slice(5, 7))}-р сар)`}
                      value={data.prevLoaded ? <Amount value={data.prevTotal} /> : "татагдаагүй"}
                      valueText={data.prevLoaded ? formatMoneyShort(data.prevTotal) : "татагдаагүй"}
                      icon={Receipt}
                      hint={data.prevLoaded ? undefined : "Харьцуулах мэдээлэл алга"}
                    />
                    <Card className="col-span-2 min-w-0">
                      <CardBody className="space-y-2 !py-3">
                        <p className="flex items-center gap-2 text-xs font-medium text-text-muted">
                          <Trophy className="size-4 text-[#ffd56b]" aria-hidden /> Хамгийн том 3 ангилал
                        </p>
                        {data.top.length === 0 && <p className="text-sm text-text-muted">Энэ сард зардал бүртгэгдээгүй</p>}
                        {data.top.map((t, i) => (
                          <div key={t.id} className="flex items-center gap-2 text-sm">
                            <span className="w-4 text-xs text-text-muted">{i + 1}</span>
                            <i className="size-2.5 shrink-0 rounded-full" style={{ background: CATEGORY_COLOR[t.id] }} aria-hidden />
                            <span className="min-w-0 flex-1 truncate text-text">{t.label}</span>
                            <span className="text-[11px] text-text-muted">{t.share.toFixed(0)}%</span>
                            <Amount value={t.amount} className="font-semibold text-text" />
                          </div>
                        ))}
                      </CardBody>
                    </Card>
                  </>
                )}
              </div>

              {data && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-bg-surface px-4 py-2.5 text-sm">
                  <span className="text-text-muted">Борлуулсан бүтээгдэхүүний өртөг</span>
                  <Amount value={data.cogs.amount} className="font-semibold text-text" />
                  <span className="text-[11px] text-text-muted">үйл ажиллагааны зардалд ороогүй ·</span>
                  <Link href="/finance/sales" className="focus-ring text-xs text-[#ffd56b] hover:underline">
                    Борлуулалт табд дэлгэрэнгүй
                  </Link>
                </div>
              )}

              {data?.otherWarn && (
                <p role="alert" className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>
                    «Бусад» ангилал үйл ажиллагааны зардлын {data.otherShare.toFixed(0)}% байна: ангилал дутуу.{" "}
                    {isAdmin ? (
                      <Link href="/admin/expense-rules" className="underline">
                        Ангиллын дүрэм нэмэх
                      </Link>
                    ) : (
                      "Админд хэлж ангиллын дүрэм нэмүүлнэ үү."
                    )}
                  </span>
                </p>
              )}

              <Card>
                <CardHeader>
                  <CardTitle>Сүүлийн 12 сарын зардал{cat ? ` · ${cat.label}` : ""}</CardTitle>
                </CardHeader>
                <CardBody className="space-y-3">
                  {data ? (
                    <>
                      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Графикийн ангилал">
                        {[{ id: null as string | null, label: "Бүгд" }, ...data.categories.map((c) => ({ id: c.id as string | null, label: c.label }))].map((c) => (
                          <button
                            key={c.id ?? "all"}
                            type="button"
                            aria-pressed={series === c.id}
                            onClick={() => setSeries(c.id)}
                            className={cn("focus-ring inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-xs text-text-muted hover:text-text", series === c.id ? "border-[rgba(255,213,107,0.6)] bg-white/[0.05] text-text" : "border-border")}
                          >
                            {c.id && <i className="size-2 rounded-full" style={{ background: CATEGORY_COLOR[c.id] }} aria-hidden />}
                            {c.label}
                          </button>
                        ))}
                      </div>
                      <DailyBarChart
                        data={chart}
                        series={[{ key: "value", label: cat ? cat.label : "Үйл ажиллагааны зардал", color: cat ? CATEGORY_COLOR[cat.id] : "rgb(var(--color-accent))" }]}
                        label={(m) => (m.slice(5, 7) === "01" ? `${m.slice(2, 4)}.${Number(m.slice(5, 7))}` : `${Number(m.slice(5, 7))}`)}
                        tooltipTitle={MN_MONTH}
                        unit="сараар"
                      />
                      {missing.length > 0 && <p className="text-[11px] text-text-muted">Татагдаагүй сар: {missing.join(", ")} (график дээр хоосон)</p>}
                    </>
                  ) : (
                    <Skeleton className="h-56" />
                  )}
                </CardBody>
              </Card>

              <Card>
                {data ? (
                  <ExpenseCategories
                    categories={data.categories}
                    onDocs={(i) => {
                      setDocs(i);
                      requestAnimationFrame(() => document.getElementById("expense-documents")?.scrollIntoView({ behavior: "smooth", block: "start" }));
                    }}
                  />
                ) : (
                  <Skeleton className="m-4 h-64" />
                )}
              </Card>

              {docs && (
                <div id="expense-documents" className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <FileText className="size-4 text-[#ffd56b]" aria-hidden />
                    <span className="font-medium text-text">{docs.name}</span>
                    <span className="text-text-muted">· Нягтланд: {docs.account} данс</span>
                    <button type="button" onClick={() => setDocs(null)} className="focus-ring min-h-9 rounded-lg px-2 text-xs text-text-muted hover:text-text">
                      Хаах
                    </button>
                  </div>
                  <DocumentList
                    key={`${docs.account}:${month}`}
                    url={`/api/dashboard/documents/account?account=${encodeURIComponent(docs.account)}&month=${month}&side=debit`}
                    title="Энэ дансны зардлын баримтууд"
                    hideWarehouseFilter
                    emptyDescription="Энэ сард энэ дансны дебит талд баримт олдсонгүй."
                  />
                </div>
              )}
            </>
          )}
        </>
      )}
    </FinanceShell>
  );
}
