"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Landmark, Settings2, Wallet } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorNote, FinanceShell } from "@/components/finance/FinanceShell";
import { DailyBarChart } from "@/components/finance/DailyBarChart";
import { FinanceKpi as KpiCard } from "@/components/finance/NgParts";
import { Amount } from "@/components/finance/cash/Amount";
import type { FeeReport } from "@/lib/onec/cash-fees";
import { CategoryPanel } from "@/components/finance/cash/CategoryPanel";
import { AccountsSection } from "@/components/finance/cash/AccountParts";
import { CashEntries, NO_FILTER, type CashEntryFilter } from "@/components/finance/cash/CashEntries";
import { useOdataData, type OdataMeta } from "@/components/finance/useOdataData";
import { RefreshButton } from "@/components/finance/useOnecRefresh";
import { useIsAdmin, useYm } from "@/components/finance/useYm";
import { formatMoneyFull, formatMoneyShort } from "@/lib/money-short";
import type { AccountCards } from "@/lib/onec/cash-accounts";
import type { CashReport, CategoryRow } from "@/lib/onec/cash-report";

type ReportResponse = CashReport & { meta: OdataMeta };
interface Trend {
  year: string;
  months: { month: string; inflow: number; outflow: number; internal: number }[];
  failed: string[];
}

const MN_MONTH = (ym: string) => `${ym.slice(0, 4)} оны ${Number(ym.slice(5, 7))}-р сар`;
const OTHER_WARN = 0.1; // «Бусад» 10%-иас их бол ангиллын дүрэм дутуу гэж сануулна

/** 12 сарын орлого, зарлага. Хөнгөн хүсэлт тул карт тусдаа ачаалагдана; нэг сар татагдаагүй бол үлдсэн нь харагдаж, тэр сар тэмдэглэгдэнэ. */
function useTrend(year: string, version: string) {
  const [state, setState] = useState<{ data: Trend | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    const c = new AbortController();
    setState((s) => ({ ...s, error: null }));
    fetch(`/api/dashboard/cash/trend?year=${year}`, { signal: c.signal })
      .then(async (res) => {
        // уншиж дундаа таслагдсан (шинэ хүсэлт эхэлсэн) хариуг хэзээ ч хадгалахгүй: хоосон `{}` нь хуудсыг унагадаг байсан
        const body = await res.json().catch(() => null);
        if (c.signal.aborted) return;
        if (!res.ok || !body || !Array.isArray(body.months)) throw new Error(body?.error ?? `Алдаа ${res.status}`);
        setState({ data: body as Trend, error: null });
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setState((s) => ({ data: s.data, error: e instanceof Error ? e.message : "12 сарын мэдээлэл татаж чадсангүй" }));
      });
    return () => c.abort();
  }, [year, version]);
  return state;
}

export default function CashPage() {
  const { ym } = useYm();
  const isAdmin = useIsAdmin();
  const { data, error, loading, retryAt, refresh } = useOdataData<ReportResponse>(`/api/dashboard/cash/report?month=${ym}`);
  const trend = useTrend(ym.slice(0, 4), data?.meta.fetchedAt ?? "");
  // «Данснууд»: одоогийн байдлаар (сонгосон сараас үл хамаарна): данс бүрийн үлдэгдэл, өнөөдрийн орсон/гарсан
  const accounts = useOdataData<AccountCards & { canManage: boolean; meta: OdataMeta }>("/api/dashboard/cash/accounts");
  const [filter, setFilter] = useState<CashEntryFilter>(NO_FILTER);
  const [showTransfers, setShowTransfers] = useState(false);
  const empty = data && data.totals.entries === 0;
  const diff = data ? Math.abs(data.totals.difference) : 0;

  // сар солигдоход шүүлт арилна
  useEffect(() => setFilter(NO_FILTER), [ym]);

  const jump = () => requestAnimationFrame(() => document.getElementById("cash-entries")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  const pickCategory = (flow: "inflow" | "outflow") => (c: CategoryRow) => {
    setFilter({ ...NO_FILTER, flow, category: c.id, categoryLabel: c.label });
    jump();
  };
  const pickParty = (flow: "inflow" | "outflow") => (c: CategoryRow, party: string) => {
    setFilter({ ...NO_FILTER, flow, category: c.id, categoryLabel: c.label, party });
    jump();
  };
  // «Банкны шимтгэл»: аль гүйлгээнд хамаарах, холбогдоогүй нь тусдаа. Ангиллын нийлбэр өөрчлөгдөхгүй (шимтгэл нэг л удаа тоологдоно).
  const pickFee = (fee: "linked" | "unlinked" | "foreign", label: string) => {
    setFilter({ ...NO_FILTER, flow: "outflow", category: "bankfee", categoryLabel: "Банкны шимтгэл", fee, feeLabel: label });
    jump();
  };
  const pickMain = (b: FeeReport["byMain"][number]) => {
    setFilter({ ...NO_FILTER, flow: "outflow", main: b.id, mainLabel: `${b.counterpart} · төлбөр, шимтгэл` });
    jump();
  };
  const feeDetail = (fees: FeeReport | null, c: CategoryRow) => {
    if (c.id !== "bankfee" || !fees) return null;
    const row = (label: string, s: { count: number; total: number }, onClick: () => void) =>
      s.count > 0 && (
        <button type="button" onClick={onClick} className="focus-ring flex min-h-9 w-full items-center justify-between gap-3 rounded-md px-2 text-left text-xs text-text-muted hover:bg-white/5 hover:text-text">
          <span className="truncate">
            {label} <span className="text-[11px]">({s.count})</span>
          </span>
          <Amount value={s.total} className="shrink-0 text-xs" />
        </button>
      );
    return (
      <>
        {row("Гадаад гүйлгээний шимтгэл", fees.foreign, () => pickFee("foreign", "Гадаад гүйлгээний шимтгэл"))}
        {row("Төлбөртэйгээ холбогдсон шимтгэл", fees.linked, () => pickFee("linked", "Төлбөртэй холбогдсон"))}
        {row("Аль гүйлгээнд хамаарах нь тодорхойгүй", fees.unlinked, () => pickFee("unlinked", "Холбогдоогүй шимтгэл"))}
        {fees.byMain.length > 0 && <p className="px-2 pt-2 text-[11px] font-medium text-text-muted">Аль төлбөрт хамаарах</p>}
        {fees.byMain.map((b) => (
          <button key={b.id} type="button" onClick={() => pickMain(b)} className="focus-ring flex min-h-9 w-full items-center justify-between gap-3 rounded-md px-2 text-left text-xs text-text-muted hover:bg-white/5 hover:text-text" title="Төлбөр ба шимтгэлийг харах">
            <span className="min-w-0 truncate">
              {b.counterpart} <span className="text-[11px]">· {b.date.slice(5)} · {formatMoneyShort(b.amount)}</span>
            </span>
            <span className="shrink-0">
              <Amount value={b.fee} className="text-xs" /> <span className="text-[11px]">×{b.count}</span>
            </span>
          </button>
        ))}
      </>
    );
  };
  const foreignFeeRow = (fees: FeeReport | null) =>
    fees && fees.foreign.count > 0 ? (
      <button
        type="button"
        onClick={() => pickFee("foreign", "Гадаад гүйлгээний шимтгэл")}
        className="focus-ring mt-2 flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-border px-3 text-left hover:bg-white/5"
        title="Сарын гадаад гүйлгээний шимтгэлүүдийг харах"
      >
        <span className="text-sm text-text">
          Гадаад гүйлгээний шимтгэл <span className="text-xs text-text-muted">· сарын нийт, {fees.foreign.count} гүйлгээ</span>
        </span>
        <Amount value={fees.foreign.total} className="shrink-0 text-sm font-semibold text-text" />
      </button>
    ) : null;
  const otherHint = (share: number) =>
    share >= OTHER_WARN && isAdmin ? (
      <p className="px-2 py-1 text-[11px] text-warning">
        «Бусад» {Math.round(share * 100)}% байна. Харилцагч бүрийг{" "}
        <Link href="/admin/cash-rules" className="underline">
          ангиллын дүрэмд
        </Link>{" "}
        нэмбэл багасна.
      </p>
    ) : null;

  return (
    <FinanceShell
      title="Мөнгөн хөрөнгө"
      subtitle={data ? `Мөнгө хаанаас орж, хаашаа гарсан · ${data.asOf}-ны үлдэгдэл` : "Мөнгө хаанаас орж, хаашаа гарсан"}
      icon={Wallet}
      lastSyncedAt={data?.meta.fetchedAt}
      connection={error || data?.meta.stale ? "offline" : data ? "ok" : null}
      refresh={<RefreshButton busy={loading} retryAt={retryAt} onClick={refresh} />}
      controls={
        isAdmin ? (
          <Link href="/admin/cash-rules" className="focus-ring inline-flex h-10 items-center gap-2 rounded-xl border border-border px-3 text-sm text-text-muted hover:text-text">
            <Settings2 className="size-4" /> Ангиллын дүрэм
          </Link>
        ) : undefined
      }
    >
      {error && <ErrorNote message={data ? `${error}. Сүүлд татсан өгөгдлийг харуулж байна.` : error} />}
      {data?.meta.stale && <ErrorNote message="Мэдээлэл түр шинэчлэгдэхгүй байна. Сүүлд татсан өгөгдлийг харуулж байна." />}

      <AccountsSection data={accounts.data} loading={accounts.loading} error={accounts.error} manageHref={isAdmin ? "/admin/cash-accounts" : undefined} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {loading && !data ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)
        ) : data ? (
          <>
            <KpiCard label="Эхний үлдэгдэл" value={<Amount value={data.totals.opening} />} valueText={formatMoneyShort(data.totals.opening)} icon={Wallet} hint={`${data.month}-01`} />
            <KpiCard
              featured
              label="Орж ирсэн"
              value={<Amount value={data.totals.inflow} />}
              valueText={formatMoneyShort(data.totals.inflow)}
              icon={ArrowDownLeft}
              tone="accent"
              onClick={() => {
                setFilter({ ...NO_FILTER, flow: "inflow" });
                jump();
              }}
            />
            <KpiCard
              label="Гарсан"
              value={<Amount value={data.totals.outflow} />}
              valueText={formatMoneyShort(data.totals.outflow)}
              icon={ArrowUpRight}
              tone="danger"
              onClick={() => {
                setFilter({ ...NO_FILTER, flow: "outflow" });
                jump();
              }}
            />
            <KpiCard
              label="Эцсийн үлдэгдэл"
              value={<Amount value={data.totals.closing} />}
              valueText={formatMoneyShort(data.totals.closing)}
              icon={Landmark}
              tone="success"
              hint={diff < 1 ? "Эхний + орсон − гарсан таарсан" : `Тулгалтад ${formatMoneyFull(data.totals.difference)} зөрүү байна`}
            />
          </>
        ) : null}
      </div>

      {data && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-white/[0.02] px-4 py-2.5 text-sm">
          <ArrowLeftRight aria-hidden className="size-4 text-text-muted" />
          <span className="text-text-muted">Дотоод шилжүүлэг (өөрийн данс хооронд, нийлбэрт орохгүй):</span>
          <Amount value={data.internal.total} className="font-medium text-text" />
          {data.internal.count > 0 && (
            <button type="button" onClick={() => setShowTransfers((s) => !s)} className="focus-ring min-h-8 rounded-lg px-2 text-xs text-[#ffd56b] hover:underline">
              {showTransfers ? "Нуух" : `${data.internal.count} шилжүүлэг харах`}
            </button>
          )}
        </div>
      )}
      {data && showTransfers && (
        <Card>
          <ul className="divide-y divide-border">
            {data.internal.items.map((t, i) => (
              <li key={`${t.date}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                <span className="ng-num w-16 text-xs text-text-muted">{t.date.slice(5)}</span>
                <span className="min-w-0 flex-1 truncate text-text">
                  {t.from} → {t.to}
                </span>
                <Amount value={t.amount} className="text-text-muted" />
              </li>
            ))}
            {data.internal.count > data.internal.items.length && <li className="px-4 py-2 text-xs text-text-muted">Хамгийн сүүлийн {data.internal.items.length} шилжүүлгийг харууллаа</li>}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{ym.slice(0, 4)} оны сар бүрийн орсон, гарсан мөнгө</CardTitle>
          {trend.data && trend.data.failed.length > 0 && <span className="text-xs text-warning">{trend.data.failed.map((m) => `${Number(m.slice(5))}-р сар`).join(", ")} татагдсангүй</span>}
        </CardHeader>
        <CardBody>
          {trend.data ? (
            <DailyBarChart
              data={trend.data.months.map((m) => ({ date: m.month, inflow: m.inflow, outflow: m.outflow }))}
              series={[
                { key: "inflow", label: "Орж ирсэн", color: "rgb(var(--color-accent))" },
                { key: "outflow", label: "Гарсан", color: "rgb(var(--color-danger))" },
              ]}
              label={(m) => `${Number(m.slice(5, 7))}`}
              tooltipTitle={MN_MONTH}
              unit="сараар"
            />
          ) : trend.error ? (
            <p className="py-10 text-center text-sm text-text-muted">{trend.error}</p>
          ) : (
            <Skeleton className="h-56" />
          )}
        </CardBody>
      </Card>

      {empty ? (
        <Card>
          <div className="px-6 py-12 text-center text-sm text-text-muted">Энэ сард мөнгөн хөрөнгийн гүйлгээ алга. Дээрээс өөр сар сонгоно уу.</div>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data ? (
            <>
              <CategoryPanel title="Хаанаас орж ирсэн" tone="in" flow={data.inflow} onPickCategory={pickCategory("inflow")} onPickParty={pickParty("inflow")} otherHint={otherHint(data.otherShare.inflow)} />
              <CategoryPanel title="Хаашаа гарсан" tone="out" flow={data.outflow} onPickCategory={pickCategory("outflow")} onPickParty={pickParty("outflow")} otherHint={otherHint(data.otherShare.outflow)} renderDetail={(c) => feeDetail(data.fees, c)} foot={foreignFeeRow(data.fees)} />
            </>
          ) : (
            <>
              <Skeleton className="h-72 rounded-xl" />
              <Skeleton className="h-72 rounded-xl" />
            </>
          )}
        </div>
      )}

      {!empty && <CashEntries month={ym} filter={filter} onFilter={setFilter} version={data?.meta.fetchedAt ?? ""} />}
    </FinanceShell>
  );
}
