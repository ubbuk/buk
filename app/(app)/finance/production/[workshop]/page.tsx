"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Factory } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorNote, FinanceShell } from "@/components/finance/FinanceShell";
import { Amount } from "@/components/finance/cash/Amount";
import { Bars, catDayBars, catMonthBars, CatLegend, CatProductLines, catSummary, DayBar, dayBars, mnDate, num, ProductLines, qtyLine } from "@/components/finance/production/DirectorParts";
import { useFinanceData } from "@/components/finance/useFinanceData";
import { isDate } from "@/lib/onec/dates";
import { resolveWorkshopParam } from "@/lib/onec/production-groups";
import type { WorkshopView } from "@/lib/onec/production-view";
import { unitName } from "@/lib/units";
import { cn } from "@/lib/utils";

const mmdd = (day: string) => `${day.slice(5, 7)}-${day.slice(8, 10)}`;
const pctText = (v: number) => `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(v)}%`;

/** /finance/production/[цех]: цех бүрийн тусдаа хуудас (латин slug: tbhets, der, ...). Хуучин кирилл нэртэй URL slug руу шилжинэ. */
function WorkshopPage() {
  const params = useParams<{ workshop: string }>();
  const ws = useMemo(() => resolveWorkshopParam(params.workshop ?? ""), [params.workshop]);
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const dayRaw = sp.get("day");
  const dayParam = isDate(dayRaw) ? dayRaw : null;

  // Хуучин кирилл URL -> латин slug (?day= хэвээр)
  useEffect(() => {
    if (ws && !ws.canonical) router.replace(`/finance/production/${ws.slug}${dayParam ? `?day=${dayParam}` : ""}`);
  }, [ws, dayParam, router]);

  const url = ws?.canonical ? `/api/dashboard/production/workshop?workshop=${ws.slug}${dayParam ? `&day=${dayParam}` : ""}` : null;
  const { data, error } = useFinanceData<WorkshopView>(url);
  const setDay = useCallback((d: string | null) => router.replace(d ? `${pathname}?day=${d}` : pathname, { scroll: false }), [pathname, router]);
  const [moreOpen, setMoreOpen] = useState(false);
  const back = `/finance/production${dayParam ? `?day=${dayParam}` : ""}`;
  const card = data?.card ?? null;
  const unit = card?.unit ?? "";
  const title = data?.name ?? ws?.name ?? "Цех";
  const onDay = (d: string) => setDay(d === data?.latestDay ? null : d);

  return (
    <FinanceShell title={title} subtitle="Цехийн өдөр, сарын гарц" icon={Factory} lastSyncedAt={data?.lastSyncedAt} notice={data?.scopeNote ? <ErrorNote message={data.scopeNote} /> : undefined} hideYm>
      <Link href={back} className="focus-ring inline-flex min-h-11 w-fit items-center rounded-xl border border-border px-4 text-sm text-text-muted hover:text-text">
        ← Бүх цех
      </Link>
      {!ws && <ErrorNote message="Цех олдсонгүй" />}
      {error && <ErrorNote message={error} />}

      {ws && !data ? (
        !error && (
          <>
            <Skeleton className="h-11 w-80 max-w-full rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
          </>
        )
      ) : (
        data &&
        card && (
          <>
            <DayBar day={data.day} today={data.today} onDay={onDay} />

            {/* Тэр өдөр */}
            <section className="rounded-xl border border-border bg-bg-surface shadow-card">
              <header className="border-b border-border px-5 py-3 text-sm font-semibold text-text">{mnDate(data.day)}</header>
              {card.day.length > 0 ? (
                <>
                  <div className="px-5 py-4">
                    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                      {card.day.map((qt) => (
                        <span key={qt.unit} className="whitespace-nowrap">
                          <span className="ng-num text-4xl font-semibold leading-none text-text">{num(qt.qty)}</span>
                          <span className="ml-2 text-sm text-text-muted">{card.concrete ? `${unitName(qt.unit)} бэлэн` : unitName(qt.unit)}</span>
                        </span>
                      ))}
                    </div>
                    {card.dayCats && <p className="mt-2 text-sm text-text-muted">{catSummary(card.dayCats, card.defectPct)}</p>}
                    {card.lateDefectDay > 0 && <p className="mt-1 text-sm text-text-muted">Дараа нь брак болсон: {num(card.lateDefectDay)}</p>}
                  </div>
                  <div className="border-t border-border">{card.concrete ? <CatProductLines products={card.products} /> : <ProductLines products={card.products} />}</div>
                </>
              ) : data.notLoaded ? (
                <p className="px-5 py-8 text-base text-text-muted">
                  Энэ өдрийн мэдээ татагдаагүй байна · Хамгийн эртний мэдээ: <span className="ng-num">{data.firstDay}</span>
                </p>
              ) : (
                <>
                  <p className="px-5 py-8 text-base text-text-muted">
                    Мэдээ ороогүй · Сүүлд: <span className="ng-num">{card.lastDay ? mmdd(card.lastDay) : "—"}</span>
                  </p>
                  {card.lateDefectDay > 0 && <p className="px-5 pb-5 text-sm text-text-muted">Дараа нь брак болсон: {num(card.lateDefectDay)}</p>}
                </>
              )}
            </section>

            {/* Энэ сар */}
            <Card>
              <CardHeader>
                <CardTitle>
                  {Number(data.day.slice(5, 7))}-р сар · {card.concrete ? "бэлэн" : "нийт"} <span className="ng-num ml-1 text-text">{qtyLine(card.month)}</span>
                </CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                {card.monthCats && (
                  <p className="text-sm text-text-muted">
                    {catSummary(card.monthCats, card.monthDefectPct)}
                    {card.lateDefectMonth > 0 && <span> · Дараа нь брак болсон: {num(card.lateDefectMonth)}</span>}
                  </p>
                )}
                {card.monthQty > 0 || card.monthDaysCats.some((d) => d.repair + d.defect > 0) ? (
                  <>
                    {card.concrete && <CatLegend />}
                    <Bars items={card.concrete ? catDayBars(card.monthDaysCats, unit) : dayBars(card.monthDays, unit)} selected={data.day} onSelect={onDay} height={120} />
                    <p className="text-[11px] text-text-muted">Өдрийн баганыг дарвал тэр өдрийн гарц дээр гарна.</p>
                  </>
                ) : (
                  <p className="text-sm text-text-muted">{data.notLoaded ? "Энэ сарын мэдээ татагдаагүй байна" : "Энэ сард мэдээ ороогүй"}</p>
                )}
              </CardBody>
              {card.monthProducts.length > 0 && (
                <div className="border-t border-border">
                  <p className="px-4 pt-3 text-xs text-text-muted">Бүтээгдэхүүнээр</p>
                  {card.concrete ? <CatProductLines products={card.monthProducts} /> : <ProductLines products={card.monthProducts} />}
                </div>
              )}
            </Card>

            {/* Сүүлийн 12 сар (өнөөдрөөс хойш; сонгосон өдрөөс үл хамаарна) */}
            <Card>
              <CardHeader>
                <CardTitle>
                  Сүүлийн 12 сар{unit ? ` · ${unitName(unit)}` : ""}
                  {data.defectPct12 !== null && <span className="ml-2 text-xs font-normal text-text-muted">12 сарын брак {pctText(data.defectPct12)}</span>}
                </CardTitle>
              </CardHeader>
              <CardBody className="space-y-3">
                {data.monthsCats && data.monthsCats.some((m) => m.ready + m.repair + m.defect > 0) ? (
                  <>
                    <CatLegend />
                    <Bars items={catMonthBars(data.monthsCats, data.monthsUnit)} selected={data.day.slice(0, 7)} labelEvery={1} height={120} />
                  </>
                ) : data.months.some((m) => m.qty > 0) ? (
                  <Bars
                    items={data.months.map((m) => ({ key: m.month, label: String(Number(m.month.slice(5, 7))), value: m.qty, title: `${m.month.slice(0, 4)} оны ${Number(m.month.slice(5, 7))}-р сар: ${num(m.qty)} ${unitName(data.monthsUnit)}` }))}
                    selected={data.day.slice(0, 7)}
                    labelEvery={1}
                    height={120}
                  />
                ) : (
                  <p className="text-sm text-text-muted">Сүүлийн 12 сард мэдээ ороогүй</p>
                )}
              </CardBody>
            </Card>

            {/* Материал: «Дэлгэрэнгүй» (анхдагч хаалттай) */}
            <Card>
              <button
                type="button"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((v) => !v)}
                className="focus-ring flex min-h-14 w-full items-center gap-2 px-5 py-3 text-left text-sm font-semibold text-text hover:bg-white/[0.03]"
              >
                <ChevronRight aria-hidden className={cn("size-4 text-text-muted transition-transform", moreOpen && "rotate-90")} />
                Дэлгэрэнгүй
                <span className="text-[11px] font-normal text-text-muted">· Энэ сард зарцуулсан материал</span>
              </button>
              {moreOpen && (
                <CardBody className="border-t border-border">
                  {data.material ? (
                    <>
                      <p className="text-xl font-semibold text-text">
                        <Amount value={data.material.amount} />
                      </p>
                      <ul className="mt-2 space-y-1 text-sm">
                        {data.material.items.map((i) => (
                          <li key={i.name} className="flex items-center justify-between gap-3">
                            <span className="min-w-0 flex-1 truncate text-text-muted">{i.name}</span>
                            <Amount value={i.amount} className="text-text" />
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="text-sm text-text-muted">Энэ сард материалын зарцуулалт бүртгэгдээгүй</p>
                  )}
                </CardBody>
              )}
            </Card>
          </>
        )
      )}
    </FinanceShell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <WorkshopPage />
    </Suspense>
  );
}
