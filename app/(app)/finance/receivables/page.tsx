"use client";

import { Landmark, Percent, Receipt, Users } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { KpiCard } from "@/components/ui/KpiCard";
import { Skeleton, SkeletonTable } from "@/components/ui/Skeleton";
import { ErrorNote, FinanceShell, NUM, money } from "@/components/finance/FinanceShell";
import { useFinanceData } from "@/components/finance/useFinanceData";
import { MonthRefreshNote, RefreshButton, useMonthRefresh } from "@/components/finance/useOnecRefresh";
import { MissingMonth } from "@/components/finance/YearSection";
import { useIsAdmin, useYm } from "@/components/finance/useYm";
import { formatNumber } from "@/lib/utils";
import type { ReceivableAccount, ReceivableCustomer, ReceivablesResult } from "@/lib/onec/receivables";

// Postgres-ийн агшин зургаас шууд; агшин зураг байхгүй бол missing
type ReceivablesResponse = ({ missing: false } & ReceivablesResult | { missing: true; asOf: string }) & { refreshing: boolean; lastAttemptOk: boolean | null; lastSyncedAt: string | null };

const customerColumns: DataTableColumn<ReceivableCustomer>[] = [
  { key: "name", header: "Харилцагч", sortable: true, accessor: (r) => r.name, render: (r) => <span className="text-text">{r.name}</span> },
  { key: "balance", header: "Авлагын үлдэгдэл", sortable: true, accessor: (r) => r.balance, className: NUM, render: (r) => <span className={r.balance < 0 ? "text-success" : undefined}>{money(r.balance)}</span> },
  { key: "share", header: "Эзлэх хувь", sortable: true, accessor: (r) => r.share, className: NUM, render: (r) => (r.balance > 0 ? `${formatNumber(r.share, 1)}%` : "—") },
];

const accountColumns: DataTableColumn<ReceivableAccount>[] = [
  { key: "code", header: "Данс", sortable: true, accessor: (r) => r.code, render: (r) => <span className="text-text">{r.code}</span> },
  { key: "name", header: "Нэр", sortable: true, accessor: (r) => r.name, render: (r) => r.name },
  { key: "customers", header: "Харилцагч", sortable: true, accessor: (r) => r.customers, className: NUM, render: (r) => formatNumber(r.customers, 0) },
  { key: "balance", header: "Үлдэгдэл", sortable: true, accessor: (r) => r.balance, className: NUM, render: (r) => money(r.balance) },
];

/** Эхний 10 өртэй харилцагч: өртийн хэмжээгээр уртыг нь харуулсан мөр */
function TopDebtors({ rows }: { rows: ReceivableCustomer[] }) {
  const max = Math.max(1, ...rows.map((r) => r.balance));
  return (
    <ol className="space-y-3">
      {rows.map((r, i) => (
        <li key={r.key || i} className="space-y-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-text">
              {i + 1}. {r.name}
            </span>
            <span className="shrink-0 tabular-nums text-text">
              {money(r.balance)} <span className="text-xs text-text-muted">({formatNumber(r.share, 1)}%)</span>
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-bg-elevated">
            <div className="h-full rounded-full bg-accent" style={{ width: `${(r.balance / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function ReceivablesPage() {
  const { ym, isCurrent } = useYm();
  const isAdmin = useIsAdmin();
  const { data, error, reload } = useFinanceData<ReceivablesResponse>(`/api/dashboard/receivables?month=${ym}`);
  // Хуудас 1С-ийг хүлээхгүй: агшин зургийг Postgres-оос шууд харуулна. Одоогийн сар 5 минутаас илүү хуучирсан бол ар талд шинэчилнэ
  // (Balance 10-110 сек); өнгөрсөн сарыг зөвхөн админ татна (сервер мөн шалгана).
  const sync = useMonthRefresh(ym, reload, "receivables");
  const canRefresh = isCurrent || isAdmin;
  const snap = data && !data.missing ? data : null;
  const waiting = data?.missing && (sync.busy || data.refreshing); // анхны агшин зураг бүрдэж байна

  return (
    <FinanceShell
      title={`Авлага${data ? ` · ${data.asOf}` : ""}`}
      lastSyncedAt={data?.lastSyncedAt}
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
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
            ) : (
              <>
                <KpiCard label="Нийт авлага" value={money(snap.totals.receivable)} icon={Landmark} tone="accent" hint="Худалдан авагчаас авах авлага" />
                <KpiCard label="Өртэй харилцагч" value={formatNumber(snap.totals.debtors, 0)} icon={Users} hint={`Нийт ${formatNumber(snap.totals.customers, 0)} харилцагч`} />
                <KpiCard label="Урьдчилж төлсөн" value={money(snap.totals.credit)} icon={Percent} hint="Кредит үлдэгдэлтэй харилцагчид" />
                <KpiCard label="НӨАТ-ын авлага" value={money(snap.totals.vat)} icon={Receipt} hint={snap.accounts.some((a) => a.code === "1271") ? "Нийт авлагад ороогүй" : "Татаж байна…"} />
              </>
            )}
          </div>

          <div className="grid gap-5 lg:grid-cols-5">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Хамгийн их өртэй 10 харилцагч</CardTitle>
              </CardHeader>
              <CardBody>{snap ? snap.top.length ? <TopDebtors rows={snap.top} /> : <p className="text-sm text-text-muted">Өртэй харилцагч алга</p> : <Skeleton className="h-56" />}</CardBody>
            </Card>
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle>Харилцагчаар</CardTitle>
              </CardHeader>
              {snap ? <DataTable data={snap.customers} columns={customerColumns} getRowId={(r) => r.key || r.name} searchPlaceholder="Харилцагч хайх..." /> : <SkeletonTable rows={6} cols={3} />}
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Авлагын дансаар</CardTitle>
            </CardHeader>
            {snap ? <DataTable data={snap.accounts} columns={accountColumns} getRowId={(r) => r.code} searchPlaceholder="Данс хайх..." /> : <SkeletonTable rows={3} cols={4} />}
          </Card>
        </>
      )}
    </FinanceShell>
  );
}
