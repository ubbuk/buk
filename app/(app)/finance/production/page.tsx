"use client";

import { Suspense, useCallback, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, CalendarClock, ChevronRight, Coins, Factory, Layers, PackageCheck, ShieldAlert, Wrench } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { DailyBarChart } from "@/components/finance/DailyBarChart";
import { ErrorNote, FinanceShell, connectionFrom } from "@/components/finance/FinanceShell";
import { FinanceKpi as KpiCard } from "@/components/finance/NgParts";
import { Amount } from "@/components/finance/cash/Amount";
import { ProductionCardView, ProductList, RangeBar, type DocState } from "@/components/finance/production/ProductionParts";
import { useFinanceData } from "@/components/finance/useFinanceData";
import { isDate } from "@/lib/onec/dates";
import { rangeLabel, type DateRange } from "@/lib/onec/production-range";
import type { ProductionView } from "@/lib/onec/production-view";
import { cn } from "@/lib/utils";
import { formatQuantities, formatQuantity } from "@/lib/units";

const MN_DAY = (date: string) => `${date.slice(0, 4)} оны ${Number(date.slice(5, 7))}-р сарын ${Number(date.slice(8, 10))}`;

function ProductionPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const from = sp.get("from");
  const to = sp.get("to");
  const dept = sp.get("dept");

  // URL: ?from=&to=&dept=. Хугацаа өгөөгүй бол сервер хамгийн сүүлд үйлдвэрлэлтэй өдрийг сонгоно.
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
  const period = data?.period;
  const docKey = (group: string | null, id: string) => `${period?.from}|${period?.to}|${group ?? ""}|${id}`;
  const asked = useRef(new Set<string>());
  const openDocs = useCallback(
    (group: string | null, id: string) => {
      if (!period) return;
      const key = `${period.from}|${period.to}|${group ?? ""}|${id}`;
      if (asked.current.has(key)) return;
      asked.current.add(key);
      setDocs((d) => ({ ...d, [key]: "loading" }));
      const q = new URLSearchParams({ from: period.from, to: period.to, id });
      if (group) q.set("group", group);
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

  const [listOpen, setListOpen] = useState(false);
  const label = period ? rangeLabel(period) : "";
  const chartUnit = data?.chart?.unit ?? "";
  const unitFmt = (v: number) => formatQuantity(v, chartUnit).short;
  const monthNo = data ? `${Number(data.month.slice(5, 7))}-р сар` : "";

  return (
    <FinanceShell
      title="Үйлдвэрлэл"
      subtitle="Цех бүр хэдийг үйлдвэрлэв: өдөр, долоо хоног, сараар. Өгөгдөл 15 минут тутам шинэчлэгдэнэ"
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {!data ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)
        ) : (
          <>
            <KpiCard
              featured
              label="Өнөөдөр"
              value={formatQuantities(data.kpi.today).short}
              valueText={formatQuantities(data.kpi.today).short.padEnd(14)}
              icon={PackageCheck}
              tone="accent"
              hint={MN_DAY(data.todayDate)}
            />
            <KpiCard
              spark={data.chart?.days.map((d) => d.confirmed + d.unconfirmed)}
              label={`Нийт гарц · ${label}`}
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

      {/* Цех бүр нэг карт */}
      {!data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-56 rounded-xl" />
          <Skeleton className="h-56 rounded-xl" />
        </div>
      ) : data.cards.length === 0 ? (
        <Card>
          <CardBody className="py-10 text-center text-sm text-text-muted">{data.scopeNote ? "Харуулах цех алга" : "Үйлдвэрлэлийн баримт татагдаагүй байна. Өгөгдөл 15 минут тутам автоматаар шинэчлэгдэнэ."}</CardBody>
        </Card>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {data.cards.map((c) => (
            <ProductionCardView key={c.name} card={c} label={label} getDocs={(id) => docs[docKey(c.name, id)]} onOpen={(id) => openDocs(c.name, id)} />
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Өдөр бүрийн гарц{chartUnit ? ` · ${formatQuantity(1, chartUnit).short.replace(/^1 /, "")}` : ""}{data ? ` · ${monthNo}` : ""}</CardTitle>
          <span className="text-[11px] text-text-muted">Сонгосон өдөр алтан хүрээтэй</span>
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
              highlightDate={data.period.to}
            />
          ) : (
            <p className="py-10 text-center text-sm text-text-muted">Энэ сард бэлэн бүтээгдэхүүний гарц бүртгэгдээгүй</p>
          )}
        </CardBody>
      </Card>

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

      {/* Нэгдсэн жагсаалт: доор, хураасан */}
      <Card>
        <button
          type="button"
          aria-expanded={listOpen}
          onClick={() => setListOpen((v) => !v)}
          className="focus-ring flex min-h-14 w-full items-center gap-2 px-5 py-3 text-left text-sm font-semibold text-text hover:bg-white/[0.03]"
        >
          <ChevronRight aria-hidden className={cn("size-4 text-text-muted transition-transform", listOpen && "rotate-90")} />
          Бүтээгдэхүүнээр нэгдсэн жагсаалт
          {data && <span className="text-[11px] font-normal text-text-muted">· {data.products.length} · {label}</span>}
        </button>
        {listOpen && data && <ProductList products={data.products} costClosed={data.cost.closed} getDocs={(id) => docs[docKey(data.group, id)]} onOpen={(id) => openDocs(data.group, id)} />}
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
