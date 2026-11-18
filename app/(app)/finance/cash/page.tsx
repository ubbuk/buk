"use client";

import { useMemo, useState } from "react";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Banknote, Landmark, ListChecks, Users, Wallet } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { ErrorNote, FinanceShell, NUM, money } from "@/components/finance/FinanceShell";
import { GranularChart } from "@/components/finance/GranularChart";
import { FilterSelect, FinanceKpi as KpiCard, ViewToggle, rankColumn, type ViewMode } from "@/components/finance/NgParts";
import { useDocDrawer } from "@/components/finance/docs/DocDrawer";
import { useOdataData, type OdataMeta } from "@/components/finance/useOdataData";
import { RefreshButton, todayUb } from "@/components/finance/useOnecRefresh";
import { useYm } from "@/components/finance/useYm";
import { formatNumber } from "@/lib/utils";
import type { CashAccount, CashCounterpart, CashEntry, CashResult } from "@/lib/onec/cash";

// 1С-ийн OData-аас шууд (5 минутын cache); 1С холбогдохгүй бол сүүлд хадгалсныг харуулна
type CashResponse = CashResult & { meta: OdataMeta };

const accountColumns: DataTableColumn<CashAccount>[] = [
  // дансны КОД биш НЭР (код нь зөвхөн tooltip-д)
  { key: "name", header: "Данс", sortable: true, accessor: (r) => `${r.name} ${r.code}`, render: (r) => <span className="text-text" title={r.code ? `Данс ${r.code}` : undefined}>{r.name}</span> },
  { key: "opening", header: "Эхний үлдэгдэл", sortable: true, accessor: (r) => r.opening, className: NUM, render: (r) => money(r.opening) },
  { key: "inflow", header: "Орлого", sortable: true, accessor: (r) => r.inflow, className: NUM, render: (r) => money(r.inflow) },
  { key: "outflow", header: "Зарлага", sortable: true, accessor: (r) => r.outflow, className: NUM, render: (r) => money(r.outflow) },
  { key: "transfers", header: "Шилжүүлэг (орсон − гарсан)", sortable: true, accessor: (r) => r.transfersIn - r.transfersOut, className: NUM, render: (r) => money(r.transfersIn - r.transfersOut) },
  { key: "closing", header: "Эцсийн үлдэгдэл", sortable: true, accessor: (r) => r.closing, className: NUM, render: (r) => <span className="text-text">{money(r.closing)}</span> },
];

const counterpartColumns: DataTableColumn<CashCounterpart>[] = [
  { key: "name", header: "Харилцагч / харьцсан данс", sortable: true, accessor: (r) => `${r.name} ${r.account}`, render: (r) => <span className="text-text" title={r.account ? `Данс ${r.account}` : undefined}>{r.name}</span> },
  { key: "inflow", header: "Орлого", sortable: true, accessor: (r) => r.inflow, className: NUM, render: (r) => (r.inflow ? <span className="text-success">{money(r.inflow)}</span> : "—") },
  { key: "outflow", header: "Зарлага", sortable: true, accessor: (r) => r.outflow, className: NUM, render: (r) => (r.outflow ? <span className="text-danger">{money(r.outflow)}</span> : "—") },
];

const entryColumns = (transfer: boolean): DataTableColumn<CashEntry>[] => [
  { key: "date", header: "Огноо", sortable: true, accessor: (r) => r.date, render: (r) => <span className="ng-num">{r.date}</span> },
  { key: "account", header: transfer ? "Зарлагадсан данс" : "Данс", accessor: (r) => r.account, render: (r) => r.account },
  { key: "counterpart", header: transfer ? "Хүлээн авсан данс" : "Харилцагч / гүйлгээний утга", accessor: (r) => `${r.counterpart} ${r.memo} ${r.article} ${r.document}`, render: (r) => (
      <div>
        <p className="text-text">{r.counterpart}</p>
        <p className="max-w-md truncate text-[11px] text-text-muted" title={r.memo}>{[r.document, r.article, r.memo].filter(Boolean).join(" · ")}</p>
      </div>
    ) },
  { key: "amount", header: "Дүн", sortable: true, accessor: (r) => (r.type === "outflow" ? -r.amount : r.amount), className: NUM, render: (r) =>
      r.type === "inflow" ? <span className="text-success">+{money(r.amount)}</span> : r.type === "outflow" ? <span className="text-danger">−{money(r.amount)}</span> : <span className="text-text-muted">{money(r.amount)}</span> },
];

const ALL = "";

export default function CashPage() {
  const { ym, isCurrent } = useYm();
  const { data, error, loading, retryAt, refresh } = useOdataData<CashResponse>(`/api/dashboard/cash?month=${ym}`);
  const [account, setAccount] = useState(ALL);
  // Дарж задлах: орлого/зарлага (KPI), харилцагч (хүснэгт) -> доорх гүйлгээний жагсаалт -> баримтын drawer
  const [flow, setFlow] = useState<"" | "inflow" | "outflow">("");
  const [party, setParty] = useState("");
  const { openDoc } = useDocDrawer();
  const jump = () => requestAnimationFrame(() => document.getElementById("cash-entries")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  const [mode, setMode] = useState<ViewMode>("chart");
  const empty = data && data.totals.entries === 0 && data.accounts.length === 0;
  const diff = data ? Math.abs(data.totals.difference) : 0;

  // «Бүх данс» шүүлтүүр: дансны хүснэгт, гүйлгээ, шилжүүлгийн жагсаалтад (дүн, график нь нийт хэвээр)
  const accountName = useMemo(() => data?.accounts.find((a) => a.key === account)?.name ?? "", [data, account]);
  const accounts = useMemo(() => (data ? data.accounts.filter((a) => !account || a.key === account) : []), [data, account]);
  const recent = useMemo(() => (data ? data.recent.filter((e) => (!account || e.account === accountName) && (!flow || e.type === flow) && (!party || e.counterpart === party)) : []), [data, account, accountName, flow, party]);
  const transfers = useMemo(() => (data ? data.transfers.filter((e) => !account || e.account === accountName || e.counterpart === accountName) : []), [data, account, accountName]);
  const spark = useMemo(() => {
    let acc = 0;
    return (data?.daily ?? []).filter((d) => !isCurrent || d.date <= todayUb()).map((d) => (acc += d.inflow));
  }, [data, isCurrent]);
  const counterpartCols = useMemo(() => (data ? [rankColumn(data.byCounterpart), ...counterpartColumns] : counterpartColumns), [data]);

  return (
    <FinanceShell
      title={`Мөнгөн хөрөнгө`}
      subtitle={data ? `1С-ээс татсан мөнгөн хөрөнгийн мэдээлэл · ${data.asOf}-ны үлдэгдэл` : "1С-ээс татсан мөнгөн хөрөнгийн мэдээлэл"}
      icon={Wallet}
      lastSyncedAt={data?.meta.fetchedAt}
      connection={error || data?.meta.stale ? "offline" : data ? "ok" : null}
      refresh={<RefreshButton busy={loading} retryAt={retryAt} onClick={refresh} />}
      controls={data && <FilterSelect icon={Banknote} label="Данс" value={account} onChange={setAccount} options={[{ value: ALL, label: "Бүх данс" }, ...data.accounts.map((a) => ({ value: a.key, label: a.name }))]} />}
      trailing={<ViewToggle value={mode} onChange={setMode} />}
    >
      {error && <ErrorNote message={data ? `${error}. Сүүлд татсан өгөгдлийг харуулж байна.` : error} />}
      {data?.meta.stale && <ErrorNote message="1С холбогдохгүй байна. Сүүлд татсан өгөгдлийг харуулж байна." />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {loading && !data ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)
        ) : data ? (
          <>
            <KpiCard featured spark={spark} label="Нийт орлого" value={money(data.totals.inflow)} icon={ArrowDownLeft} tone="accent" onClick={() => { setFlow("inflow"); jump(); }} />
            <KpiCard label="Эхний үлдэгдэл" value={money(data.totals.opening)} icon={Wallet} hint={`${data.month}-01`} />
            <KpiCard label="Нийт зарлага" value={money(data.totals.outflow)} icon={ArrowUpRight} tone="danger" onClick={() => { setFlow("outflow"); jump(); }} />
            <KpiCard label="Дотоод шилжүүлэг" value={money(data.totals.internal)} icon={ArrowLeftRight} hint="Орлого, зарлагад тооцоогүй" />
            <KpiCard label="Эцсийн үлдэгдэл" value={money(data.totals.closing)} icon={Landmark} tone="success" hint={diff < 1 ? "Эхний + орлого − зарлага таарсан" : `Тулгалтад ${money(data.totals.difference)} зөрүүтэй`} />
          </>
        ) : null}
      </div>

      {empty ? (
        <Card>
          <div className="px-6 py-12 text-center text-sm text-text-muted">Энэ сард мөнгөн хөрөнгийн гүйлгээ алга. Дээрээс өөр сар сонгоно уу.</div>
        </Card>
      ) : (
        <>
          {mode === "chart" && (
            <Card>
              <CardHeader>
                <CardTitle>Өдөр бүрийн орлого, зарлага</CardTitle>
              </CardHeader>
              <CardBody>
                {data ? (
                  <GranularChart
                    data={data.daily}
                    keys={["inflow", "outflow"]}
                    today={isCurrent ? todayUb() : undefined}
                    series={[
                      { key: "inflow", label: "Орлого", color: "rgb(var(--color-accent))" },
                      { key: "outflow", label: "Зарлага", color: "rgb(var(--color-danger))" },
                    ]}
                  />
                ) : (
                  <Skeleton className="h-56" />
                )}
              </CardBody>
            </Card>
          )}

          <Card>
            {data ? (
              <DataTable
                heading={
                  <>
                    <Banknote className="size-4 text-[#ffd56b]" />
                    Данс, банкаар
                    {diff >= 1 && <span className="text-xs font-normal text-warning">Тулгалтын зөрүү {formatNumber(data.totals.difference, 2)}₮</span>}
                  </>
                }
                data={accounts}
                columns={accountColumns}
                getRowId={(r) => r.key}
                onRowClick={(r) => {
                  setAccount(r.key);
                  jump();
                }}
                searchPlaceholder="Данс хайх..."
              />
            ) : (
              <SkeletonTable rows={4} cols={6} />
            )}
          </Card>

          <Card>
            {data ? (
              <DataTable
                heading={
                  <>
                    <Users className="size-4 text-[#ffd56b]" />
                    Харилцагч, харьцсан дансаар (эхний 20)
                  </>
                }
                data={data.byCounterpart}
                columns={counterpartCols}
                getRowId={(r) => r.key}
                onRowClick={(r) => {
                  setParty(r.name);
                  jump();
                }}
                searchPlaceholder="Харилцагч, данс хайх..."
              />
            ) : (
              <SkeletonTable rows={6} cols={3} />
            )}
          </Card>

          {data && transfers.length > 0 && (
            <Card>
              <DataTable
                heading={
                  <>
                    <ArrowLeftRight className="size-4 text-[#ffd56b]" />
                    Дотоод шилжүүлэг
                  </>
                }
                data={transfers}
                columns={entryColumns(true)}
                getRowId={(r) => r.id}
                onRowClick={(r) => openDoc(r.docType, r.ref)}
                searchPlaceholder="Шилжүүлэг хайх..."
              />
            </Card>
          )}

          <Card>
            {(flow || party || account) && (
              <div id="cash-entries" className="flex flex-wrap items-center gap-2 px-4 pt-3 text-sm">
                <span className="text-text-muted">Шүүлт:</span>
                {flow && <span className="rounded-full border border-[rgba(80,140,240,0.4)] px-2.5 py-0.5 text-xs text-text">{flow === "inflow" ? "Орлого" : "Зарлага"}</span>}
                {account && <span className="rounded-full border border-[rgba(80,140,240,0.4)] px-2.5 py-0.5 text-xs text-text">{accountName}</span>}
                {party && <span className="rounded-full border border-[rgba(80,140,240,0.4)] px-2.5 py-0.5 text-xs text-text">{party}</span>}
                <button
                  type="button"
                  onClick={() => {
                    setFlow("");
                    setParty("");
                    setAccount(ALL);
                  }}
                  className="focus-ring rounded-lg px-2 py-1 text-xs text-text-muted hover:text-text"
                >
                  Шүүлт арилгах
                </button>
              </div>
            )}
            {!(flow || party || account) && <span id="cash-entries" />}
            {data ? (
              <DataTable
                heading={
                  <>
                    <ListChecks className="size-4 text-[#ffd56b]" />
                    Сүүлийн гүйлгээнүүд (сүүлийн 200) · дарвал баримт нээгдэнэ
                  </>
                }
                data={recent}
                columns={entryColumns(false)}
                getRowId={(r) => r.id}
                onRowClick={(r) => openDoc(r.docType, r.ref)}
                searchPlaceholder="Харилцагч, утга, зүйлээр хайх..."
              />
            ) : (
              <SkeletonTable rows={4} cols={4} />
            )}
          </Card>
        </>
      )}
    </FinanceShell>
  );
}
