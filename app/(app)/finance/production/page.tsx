"use client";

import { useCallback, useState } from "react";
import { AlertTriangle, CalendarClock, Coins, Factory, Layers, PackageCheck, ShieldAlert, Wrench } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { DailyBarChart } from "@/components/finance/DailyBarChart";
import { ErrorNote, FinanceShell, connectionFrom } from "@/components/finance/FinanceShell";
import { FinanceKpi as KpiCard } from "@/components/finance/NgParts";
import { Amount } from "@/components/finance/cash/Amount";
import { CrusherSection, DepartmentList, ProductList } from "@/components/finance/production/ProductionParts";
import { useFinanceData } from "@/components/finance/useFinanceData";
import { useYm } from "@/components/finance/useYm";
import type { DocLine, ProductionView } from "@/lib/onec/production-view";
import { formatQuantities, formatQuantity } from "@/lib/units";

const MN_DAY = (date: string) => `${date.slice(0, 4)} оны ${Number(date.slice(5, 7))}-р сарын ${Number(date.slice(8, 10))}`;

export default function ProductionPage() {
  const { ym: month, isCurrent } = useYm();
  const { data, error } = useFinanceData<ProductionView>(`/api/dashboard/production?month=${month}`);
  const [docs, setDocs] = useState<Record<string, DocLine[] | "loading" | "error">>({});

  // Баримтыг мөрийг нээхэд л (нэг удаа) татна: баримтын дугаар зөвхөн хамгийн доод drill-down-д
  const openProduct = useCallback(
    (id: string | null) => {
      if (!id || docs[id]) return;
      setDocs((d) => ({ ...d, [id]: "loading" }));
      fetch(`/api/dashboard/production/docs?month=${month}&id=${encodeURIComponent(id)}`)
        .then(async (r) => (r.ok ? ((await r.json()) as { docs: DocLine[] }).docs : Promise.reject(new Error(String(r.status)))))
        .then((rows) => setDocs((d) => ({ ...d, [id]: rows })))
        .catch(() => setDocs((d) => ({ ...d, [id]: "error" })));
    },
    [docs, month]
  );

  const label = isCurrent ? "Энэ сар" : `${Number(month.slice(5, 7))}-р сар`;
  const chartUnit = data?.chart?.unit ?? "";
  const unitFmt = (v: number) => formatQuantity(v, chartUnit).short;

  return (
    <FinanceShell
      title="Үйлдвэрлэл"
      subtitle="Цех бүр өдөр бүр юу үйлдвэрлэв: бүтээгдэхүүнээр, цехээр, өртөгтэй нь"
      icon={Factory}
      lastSyncedAt={data?.lastSyncedAt}
      connection={connectionFrom(data?.lastSyncedAt)}
      notice={data?.scopeNote ? <ErrorNote message={data.scopeNote} /> : undefined}
    >
      {error && <ErrorNote message={error} />}

      {data?.empty && !data.scopeNote ? (
        <Card>
          <CardBody className="py-10 text-center text-sm text-text-muted">Энэ сард үйлдвэрлэлийн баримт татагдаагүй байна. Өгөгдөл 15 минут тутам автоматаар шинэчлэгдэнэ.</CardBody>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {!data ? (
              Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)
            ) : (
              <>
                {isCurrent && (
                  <KpiCard
                    featured
                    label="Өнөөдөр"
                    value={formatQuantities(data.kpi.today).short}
                    valueText={formatQuantities(data.kpi.today).short.padEnd(14)}
                    icon={PackageCheck}
                    tone="accent"
                    hint={data.today ? MN_DAY(data.today) : undefined}
                  />
                )}
                <KpiCard
                  featured={!isCurrent}
                  spark={data.chart?.days.map((d) => d.confirmed + d.unconfirmed)}
                  label={`${label}, нийт гарц`}
                  value={formatQuantities(data.kpi.month).short}
                  valueText={formatQuantities(data.kpi.month).short.padEnd(14)}
                  icon={Layers}
                  tone="accent"
                  hint="Бэлэн бүтээгдэхүүн, бракгүй"
                />
                <KpiCard label="Бүтээгдэхүүний төрөл" value={String(data.kpi.productTypes)} icon={Wrench} hint="Нэр төрөл (засвар нэгтгэсэн)" />
                <KpiCard
                  label="Брак хувь"
                  value={data.kpi.defectPct === null ? "—" : `${data.kpi.defectPct.toFixed(1)}%`}
                  icon={ShieldAlert}
                  tone={data.kpi.defectPct !== null && data.kpi.defectPct >= 3 ? "danger" : "neutral"}
                  hint={data.kpi.defectPct === null ? "Брак бүртгэгдээгүй" : `Брак ${formatQuantities(data.kpi.defect).short}`}
                />
                <KpiCard
                  label="Нягтлан батлаагүй"
                  value={`${data.kpi.unconfirmedDocs} баримт`}
                  icon={AlertTriangle}
                  tone={data.kpi.unconfirmedDocs > 0 ? "warning" : "success"}
                  hint={data.kpi.unconfirmedDocs > 0 ? `${formatQuantities(data.kpi.unconfirmed).short} нийт дүнд орсон` : "Бүх баримт батлагдсан"}
                />
              </>
            )}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Өдөр бүрийн гарц{chartUnit ? ` · ${formatQuantity(1, chartUnit).short.replace(/^1 /, "")}` : ""}</CardTitle>
              <span className="text-[11px] text-text-muted">Өнөөдөр алтан хүрээтэй</span>
            </CardHeader>
            <CardBody>
              {!data ? (
                <Skeleton className="h-56" />
              ) : data.chart ? (
                <DailyBarChart
                  data={data.chart.days.map((d) => ({ date: d.date, confirmed: d.confirmed, unconfirmed: d.unconfirmed }))}
                  series={[
                    { key: "confirmed", label: "Батлагдсан", color: "rgb(var(--color-accent))" },
                    { key: "unconfirmed", label: "Нягтлан батлаагүй", color: "#fb923c" },
                  ]}
                  label={(d) => String(Number(d.slice(8, 10)))}
                  tooltipTitle={MN_DAY}
                  valueFormat={unitFmt}
                  axisFormat={(v) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(v)}
                  highlightDate={data.today ?? undefined}
                />
              ) : (
                <p className="py-10 text-center text-sm text-text-muted">Энэ сард бэлэн бүтээгдэхүүний гарц бүртгэгдээгүй</p>
              )}
            </CardBody>
          </Card>

          <Card>{!data ? <Skeleton className="m-4 h-64" /> : <ProductList products={data.products} costClosed={data.cost.closed} docs={docs} onOpen={openProduct} />}</Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Цехээр</CardTitle>
              </CardHeader>
              {!data ? <Skeleton className="m-4 h-40" /> : <DepartmentList departments={data.departments} />}
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Coins className="size-4 text-[#ffd56b]" aria-hidden /> Өртөг ба материал
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
                      <p className="text-xs text-text-muted">Материалын зарцуулалт ({label.toLowerCase()})</p>
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
          </div>

          {data?.crusher && <Card>{<CrusherSection crusher={data.crusher} />}</Card>}
        </>
      )}
    </FinanceShell>
  );
}
