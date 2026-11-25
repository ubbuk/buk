"use client";

import { Suspense, useCallback, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, CalendarClock, Coins, Factory, Layers, PackageCheck, ShieldAlert, Wrench } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { DailyBarChart } from "@/components/finance/DailyBarChart";
import { ErrorNote, FinanceShell, connectionFrom } from "@/components/finance/FinanceShell";
import { FinanceKpi as KpiCard } from "@/components/finance/NgParts";
import { Amount } from "@/components/finance/cash/Amount";
import { ProductionCardView, ProductTable, RangeBar, type DocState } from "@/components/finance/production/ProductionParts";
import { useFinanceData } from "@/components/finance/useFinanceData";
import { isDate } from "@/lib/onec/dates";
import { rangeLabel, type DateRange } from "@/lib/onec/production-range";
import type { ProductionView } from "@/lib/onec/production-view";
import { formatQuantities, formatQuantity } from "@/lib/units";

const MN_DAY = (date: string) => `${date.slice(0, 4)} оны ${Number(date.slice(5, 7))}-р сарын ${Number(date.slice(8, 10))}`;
const MN_MONTH = (m: string) => `${m.slice(0, 4)} оны ${Number(m.slice(5, 7))}-р сар`;
const axis = (v: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(v);

function ProductionPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const from = sp.get("from");
  const to = sp.get("to");
  const dept = sp.get("dept");

  // URL: ?from=&to=&dept=. Хугацаа өгөөгүй бол «Энэ сар» (сарын 1-ээс өнөөдөр).
  const url = useMemo(() => {
    const q = new URLSearchParams();
    if (isDate(from) && isDate(to)) {
      q.set("from", from);
      q.set("to", to);
    }
    if (dept) q.set("dept", dept);
    return `/api/dashboard/production?${q}`;
  }, [from, to, dept]);
  const { data, error } = useFinanceData<ProductionView>(url);

  const update = useCallback(
    (patch: { range?: DateRange; dept?: string | null }) => {
      const next = new URLSearchParams(sp.toString());
      if (patch.range) {
        next.set("from", patch.range.from);
        next.set("to", patch.range.to);
      }
      if (patch.dept !== undefined) {
        if (patch.dept) next.set("dept", patch.dept);
        else next.delete("dept");
      }
      router.replace(`${pathname}?${next}`, { scroll: false });
    },
    [sp, pathname, router]
  );

  // Баримтыг мөрийг нээхэд л (нэг удаа) татна: баримтын дугаар, цаг зөвхөн хамгийн доод drill-down-д
  const [docs, setDocs] = useState<Record<string, DocState>>({});
  const asked = useRef(new Set<string>());
  const period = data?.period;
  const docKey = (card: string, id: string) => `${period?.from}|${period?.to}|${card}|${id}`;
  const openDocs = useCallback(
    (card: string, id: string) => {
      if (!period) return;
      const key = `${period.from}|${period.to}|${card}|${id}`;
      if (asked.current.has(key)) return;
      asked.current.add(key);
      setDocs((d) => ({ ...d, [key]: "loading" }));
      const q = new URLSearchParams({ from: period.from, to: period.to, id, group: card });
      fetch(`/api/dashboard/production/docs?${q}`)
        .then(async (r) => (r.ok ? ((await r.json()) as { docs: DocState }).docs : Promise.reject(new Error(String(r.status)))))
        .then((rows) => setDocs((x) => ({ ...x, [key]: rows })))
        .catch(() => {
          asked.current.delete(key);
          setDocs((x) => ({ ...x, [key]: "error" }));
        });
    },
    [period]
  );

  const label = period ? rangeLabel(period) : "";
  const chartUnit = data?.chart?.unit ?? "";
  const monthNo = data ? `${Number(data.month.slice(5, 7))}-р сар` : "";
  const kpi = data?.kpi;
  const defectShown = kpi?.defectPct != null;
  const tableCards = data ? (data.group ? data.cards.filter((c) => c.name === data.group) : data.cards) : [];

  return (
    <FinanceShell
      title="Үйлдвэрлэл"
      subtitle="Цех бүр хэдийг үйлдвэрлэв: сар, долоо хоног, өдөр. Өгөгдөл 15 минут тутам шинэчлэгдэнэ"
      icon={Factory}
      lastSyncedAt={data?.lastSyncedAt}
      connection={connectionFrom(data?.lastSyncedAt)}
      notice={data?.scopeNote ? <ErrorNote message={data.scopeNote} /> : undefined}
      hideYm
    >
      {error && <ErrorNote message={error} />}

      {data && period ? (
        <RangeBar period={period} today={data.todayDate} groups={data.groups} group={data.group} onRange={(range) => update({ range })} onGroup={(g) => update({ dept: g })} />
      ) : (
        <Skeleton className="h-10 w-full max-w-xl rounded-xl" />
      )}

      {/* Хоосон («—», 0) KPI картыг нууна */}
      {!data ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      ) : (
        kpi &&
        (() => {
          const items: React.ReactNode[] = [];
          const featured = () => items.length === 0;
          if (kpi.today.length > 0)
            items.push(<KpiCard key="today" featured={featured()} label="Өнөөдөр" value={formatQuantities(kpi.today).short} valueText={formatQuantities(kpi.today).short.padEnd(14)} icon={PackageCheck} tone="accent" hint={MN_DAY(data.todayDate)} />);
          if (kpi.month.length > 0)
            items.push(
              <KpiCard
                key="total"
                featured={featured()}
                spark={data.chart?.days.map((d) => d.confirmed + d.unconfirmed)}
                label={`Нийт гарц · ${label}`}
                value={formatQuantities(kpi.month).short}
                valueText={formatQuantities(kpi.month).short.padEnd(14)}
                icon={Layers}
                tone="accent"
                hint="Бэлэн бүтээгдэхүүн, бракгүй"
              />
            );
          if (kpi.productTypes > 0) items.push(<KpiCard key="types" featured={featured()} label="Бүтээгдэхүүний төрөл" value={String(kpi.productTypes)} icon={Wrench} hint="Нэр төрөл (засвар нэгтгэсэн)" />);
          if (defectShown)
            items.push(<KpiCard key="defect" featured={featured()} label="Брак хувь" value={`${kpi.defectPct!.toFixed(1)}%`} icon={ShieldAlert} tone={kpi.defectPct! >= 3 ? "danger" : "neutral"} hint={`Брак ${formatQuantities(kpi.defect).short}`} />);
          if (kpi.unconfirmedDocs > 0)
            items.push(<KpiCard key="unc" featured={featured()} label="Нягтлан батлаагүй" value={`${kpi.unconfirmedDocs} баримт`} icon={AlertTriangle} tone="warning" hint={`${formatQuantities(kpi.unconfirmed).short} нийт дүнд орсон`} />);
          return items.length ? <div className="grid grid-cols-2 gap-3 lg:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">{items}</div> : null;
        })()
      )}

      {/* Цех бүр нэг карт (тохиргооны дагуу). Дарвал тэр цехээр шүүгдэнэ. */}
      {!data ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      ) : data.cards.length === 0 ? (
        <Card>
          <CardBody className="py-10 text-center text-sm text-text-muted">{data.scopeNote ? "Харуулах цех алга" : "Үйлдвэрлэлийн баримт татагдаагүй байна. Өгөгдөл 15 минут тутам автоматаар шинэчлэгдэнэ."}</CardBody>
        </Card>
      ) : (
        <div className="grid items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {data.cards.map((c) => (
            <ProductionCardView key={c.name} card={c} selected={data.group === c.name} onSelect={() => update({ dept: data.group === c.name ? null : c.name })} />
          ))}
        </div>
      )}

      {/* Гол хүснэгт: бүтээгдэхүүн × цех */}
      <Card>
        <CardHeader>
          <CardTitle>
            Бүтээгдэхүүн × цех{data ? ` · ${label}` : ""}
            {data?.group ? ` · ${data.group}` : ""}
          </CardTitle>
          <span className="text-[11px] text-text-muted">Мөрийг дарвал өдрөөр задарна</span>
        </CardHeader>
        {!data ? <Skeleton className="m-4 h-64" /> : <ProductTable cards={tableCards} getDocs={(c, id) => docs[docKey(c, id)]} onOpen={openDocs} />}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Өдөр бүрийн гарц{chartUnit ? ` · ${formatQuantity(1, chartUnit).short.replace(/^1 /, "")}` : ""}
            {data ? ` · ${monthNo}` : ""}
            {data?.group ? ` · ${data.group}` : ""}
          </CardTitle>
          <span className="text-[11px] text-text-muted">Сонгосон өдөр алтан хүрээтэй</span>
        </CardHeader>
        <CardBody className="space-y-2">
          {!data ? (
            <Skeleton className="h-56" />
          ) : data.chart ? (
            <>
              <DailyBarChart
                data={data.chart.days.map((d) => ({ date: d.date, confirmed: d.confirmed, unconfirmed: d.unconfirmed }))}
                series={[
                  { key: "confirmed", label: "Батлагдсан", color: "rgb(var(--color-accent))" },
                  { key: "unconfirmed", label: "Нягтлан батлаагүй", color: "#fb923c" },
                ]}
                label={(d) => String(Number(d.slice(8, 10)))}
                tooltipTitle={MN_DAY}
                valueFormat={(v) => formatQuantity(v, chartUnit).short}
                axisFormat={axis}
                highlightDate={data.period.to}
              />
              <p className="text-[11px] text-text-muted">Огноо = 1С-д тайлан бичсэн өдөр.</p>
            </>
          ) : (
            <p className="py-10 text-center text-sm text-text-muted">Энэ сард бэлэн бүтээгдэхүүний гарц бүртгэгдээгүй</p>
          )}
        </CardBody>
      </Card>

      {/* Цех сонгоход: сүүлийн 12 сарын гарц */}
      {data?.group && (
        <Card>
          <CardHeader>
            <CardTitle>Сүүлийн 12 сарын гарц · {data.group}</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2">
            {data.monthly ? (
              <>
                <DailyBarChart
                  data={data.monthly.months.map((m) => ({ date: m.month, confirmed: m.confirmed, unconfirmed: m.unconfirmed }))}
                  series={[
                    { key: "confirmed", label: "Батлагдсан", color: "rgb(var(--color-accent))" },
                    { key: "unconfirmed", label: "Нягтлан батлаагүй", color: "#fb923c" },
                  ]}
                  label={(m) => `${m.slice(2, 4)}.${m.slice(5, 7)}`}
                  tooltipTitle={MN_MONTH}
                  unit="сараар"
                  valueFormat={(v) => formatQuantity(v, data.monthly!.unit).short}
                  axisFormat={axis}
                  highlightDate={data.month}
                />
                <p className="text-[11px] text-text-muted">Огноо = 1С-д тайлан бичсэн өдөр (сар нь тайлангийн өдрийн сар). Татагдаагүй сар хоосон харагдана.</p>
              </>
            ) : (
              <p className="py-10 text-center text-sm text-text-muted">Сүүлийн 12 сард энэ цехийн гарц бүртгэгдээгүй</p>
            )}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Coins className="size-4 text-[#ffd56b]" aria-hidden /> Өртөг ба материал{data ? ` · ${monthNo}` : ""}
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          {!data ? (
            <Skeleton className="h-40" />
          ) : (
            <>
              <div>
                <p className="text-xs text-text-muted">Үйлдвэрлэлийн өртөг</p>
                {data.cost.closed && data.cost.total !== null ? (
                  <p className="mt-1 text-xl font-semibold text-text">
                    <Amount value={data.cost.total} />
                  </p>
                ) : (
                  <p className="mt-1 flex items-start gap-2 text-sm text-text-muted">
                    <CalendarClock className="mt-0.5 size-4 shrink-0 text-[#ffd56b]" aria-hidden />
                    {data.cost.message ?? "Өртөг тодорхойгүй"}
                  </p>
                )}
                {!data.cost.closed && <p className="mt-1 text-[11px] text-text-muted">Бодит өртөг нь сар хаагдсаны дараа гарна.</p>}
              </div>
              <div className="border-t border-border pt-3">
                <p className="text-xs text-text-muted">Материалын зарцуулалт ({monthNo})</p>
                {data.material ? (
                  <>
                    <p className="mt-1 text-xl font-semibold text-text">
                      <Amount value={data.material.amount} />
                    </p>
                    <ul className="mt-2 space-y-1 text-xs">
                      {data.material.departments.map((d) => (
                        <li key={d.name} className="flex items-center justify-between gap-3">
                          <span className="min-w-0 flex-1 truncate text-text-muted">{d.name}</span>
                          <Amount value={d.amount} className="text-text" />
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="mt-1 text-sm text-text-muted">Энэ сард материалын зарцуулалт бүртгэгдээгүй</p>
                )}
              </div>
            </>
          )}
        </CardBody>
      </Card>
    </FinanceShell>
  );
}

// useSearchParams: Suspense-ээр боож, хуудас бүтнээрээ статик болохоос сэргийлнэ
export default function Page() {
  return (
    <Suspense fallback={null}>
      <ProductionPage />
    </Suspense>
  );
}
