"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Factory } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorNote, FinanceShell } from "@/components/finance/FinanceShell";
import { Amount } from "@/components/finance/cash/Amount";
import { Bars, ConvDayLines, ConvProductLines, convSummary, CatLegend, CatProductLines, catSummary, DayBar, mnDate, num, pct, ProductLegend, ProductLines, productColorNames, productDefectPct, productStackBars, productSummary, productTotals, shortUnit, singleProductBars, typesText, PRODUCT_COLORS, OTHER_COLOR, type ProductSeriesPoint } from "@/components/finance/production/DirectorParts";
import { useFinanceData } from "@/components/finance/useFinanceData";
import { isDate } from "@/lib/onec/dates";
import { resolveWorkshopParam } from "@/lib/onec/production-groups";
import type { WorkshopView } from "@/lib/onec/production-view";
import { cn } from "@/lib/utils";

const mmdd = (day: string) => `${day.slice(5, 7)}-${day.slice(8, 10)}`;
const monthDay = (day: string) => `${Number(day.slice(5, 7))}-р сарын ${Number(day.slice(8, 10))}`;

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
  // Графикт харуулах бүтээгдэхүүн (null = бүгдийг бүтээгдэхүүнээр давхарлана)
  const [pick, setPick] = useState<string | null>(null);
  useEffect(() => setPick(null), [ws?.slug]);
  const back = `/finance/production${dayParam ? `?day=${dayParam}` : ""}`;
  const card = data?.card ?? null;
  const unit = card?.unit ?? "";
  const title = data?.name ?? ws?.name ?? "Цех";
  const hasConv = !!card && (card.convMonth.fromDefect + card.convMonth.fromRepair > 0 || card.convDay.fromDefect + card.convDay.fromRepair > 0);
  const onDay = (d: string) => setDay(d === data?.latestDay ? null : d);

  // Графикийн цуваа: өдөр бүр (сонгосон сар), сар бүр (сүүлийн 12 сар). Өнгө, сонголт хоёр графикт ижил байхын тулд нэг жагсаалтаас.
  const daysSeries: ProductSeriesPoint[] = useMemo(() => {
    if (!card) return [];
    const by = new Map(card.monthDaysProducts.map((d) => [d.date, d.items]));
    return card.monthDays.map((d) => ({ key: d.date, label: String(Number(d.date.slice(8, 10))), when: monthDay(d.date), items: by.get(d.date) ?? [] }));
  }, [card]);
  const monthsSeries: ProductSeriesPoint[] = useMemo(
    () => (data?.monthsProducts ?? []).map((m) => ({ key: m.month, label: String(Number(m.month.slice(5, 7))), when: `${m.month.slice(0, 4)} оны ${Number(m.month.slice(5, 7))}-р сар`, items: m.items })),
    [data?.monthsProducts]
  );
  // Цехийн ТОГТМОЛ өнгө: нэг бүтээгдэхүүн өдрийн болон 12 сарын графикт ижил өнгөтэй. Өнгийг сарын жагсаалтын эрэмбээр (5 хүртэл) оноож, хоёр графикт хуваалцана; үлдсэн нь «Бусад».
  const colorNames = useMemo(() => productColorNames(card?.monthProducts ?? [], [...daysSeries, ...monthsSeries]), [card, daysSeries, monthsSeries]);
  const namesOf = (series: readonly ProductSeriesPoint[]) => new Set(series.flatMap((pt) => pt.items.map((p) => p.name)));
  const dayPresent = useMemo(() => namesOf(daysSeries), [daysSeries]);
  const monthPresent = useMemo(() => namesOf(monthsSeries), [monthsSeries]);
  const allPresent = useMemo(() => new Set([...dayPresent, ...monthPresent]), [dayPresent, monthPresent]);
  const dayOther = [...dayPresent].some((n) => !colorNames.includes(n));
  const monthOther = [...monthPresent].some((n) => !colorNames.includes(n));
  // Нэг л бүтээгдэхүүнтэй цех: тэр бүтээгдэхүүнийг (бетон хийцийн цехэд Бэлэн/Засвар/Брак-аар) шууд харуулна
  const only = allPresent.size === 1 ? [...allPresent][0] : null;
  const shown = pick && allPresent.has(pick) ? pick : only;
  const shownColor = shown ? (PRODUCT_COLORS[colorNames.indexOf(shown)] ?? OTHER_COLOR) : undefined;
  const dayItems = shown ? singleProductBars(daysSeries, shown, !!card?.concrete, unit, shownColor) : productStackBars(daysSeries, colorNames, unit);
  const monthItems = shown ? singleProductBars(monthsSeries, shown, !!card?.concrete, unit, shownColor) : productStackBars(monthsSeries, colorNames, unit);
  const shownTotals = shown ? productTotals(monthsSeries, shown) : null;
  const shownDefectPct = shownTotals && card?.concrete ? productDefectPct({ qty: shownTotals.ready, repair: shownTotals.repair, defect: shownTotals.defect }) : null;
  const daySum = card ? productSummary(card.products) : null;
  const monthSum = card ? productSummary(card.monthProducts) : null;

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
                    {daySum?.kind === "single" ? (
                      <>
                        <p className="whitespace-nowrap">
                          <span className="ng-num text-4xl font-semibold leading-none text-text">{num(daySum.product.qty)}</span>
                          <span className="ml-2 text-sm text-text-muted">
                            {shortUnit(daySum.product.unit)}
                            {card.concrete ? " бэлэн" : ""}
                          </span>
                        </p>
                        <p className="mt-1.5 text-sm text-text-muted">{daySum.product.name}</p>
                        {card.dayCats && <p className="mt-1 text-sm text-text-muted">{catSummary(card.dayCats, card.defectPct)}</p>}
                      </>
                    ) : (
                      <p className="text-3xl font-semibold leading-tight text-text">{typesText(card.products.length)}</p>
                    )}
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

            {/* Энэ сар: бүтээгдэхүүний жагсаалт ДЭЭР, график доор */}
            <Card>
              <CardHeader>
                <CardTitle>
                  {Number(data.day.slice(5, 7))}-р сар ·{" "}
                  {monthSum?.kind === "single" ? (
                    <span className="ng-num ml-1 text-text">
                      {monthSum.product.name} {num(monthSum.product.qty)} {shortUnit(monthSum.product.unit)}
                    </span>
                  ) : monthSum?.kind === "many" ? (
                    <span className="ml-1 text-text">{typesText(monthSum.count)}</span>
                  ) : (
                    <span className="ml-1 text-text-muted">мэдээ ороогүй</span>
                  )}
                </CardTitle>
              </CardHeader>
              {card.monthProducts.length > 0 && <div className="border-t border-border">{card.concrete ? <CatProductLines products={card.monthProducts} /> : <ProductLines products={card.monthProducts} />}</div>}
              <CardBody className="space-y-3 border-t border-border">
                {monthSum?.kind === "single" && card.monthCats && (
                  <p className="text-sm text-text-muted">
                    {catSummary(card.monthCats, card.monthDefectPct)}
                    {card.lateDefectMonth > 0 && <span> · Дараа нь брак болсон: {num(card.lateDefectMonth)}</span>}
                  </p>
                )}
                {monthSum?.kind === "many" && card.lateDefectMonth > 0 && <p className="text-sm text-text-muted">Дараа нь брак болсон: {num(card.lateDefectMonth)}</p>}
                {daysSeries.some((pt) => pt.items.length > 0) ? (
                  <>
                    {dayPresent.size > 1 && <ProductLegend names={colorNames} present={dayPresent} hasOther={dayOther} selected={shown} onSelect={setPick} />}
                    {shown && card.concrete && <CatLegend />}
                    <Bars items={dayItems} selected={data.day} onSelect={onDay} height={120} />
                    <p className="text-[11px] text-text-muted">Өдрийн баганыг дарвал тэр өдрийн гарц дээр гарна.{dayPresent.size > 1 && !shown ? " Өнгө бүр нэг бүтээгдэхүүн (12 сарын графикт ижил)." : ""}</p>
                  </>
                ) : (
                  <p className="text-sm text-text-muted">{data.notLoaded ? "Энэ сарын мэдээ татагдаагүй байна" : "Энэ сард мэдээ ороогүй"}</p>
                )}
              </CardBody>
            </Card>

            {/* Сүүлийн 12 сар (өнөөдрөөс хойш; сонгосон өдрөөс үл хамаарна). Брак хувь зөвхөн сонгосон бүтээгдэхүүнээр */}
            <Card>
              <CardHeader>
                <CardTitle>
                  Сүүлийн 12 сар{unit ? ` · ${shortUnit(unit)}` : ""}
                  {shown && shownDefectPct !== null && (
                    <span className="ml-2 text-xs font-normal text-text-muted">
                      {shown}: 12 сарын брак {pct(shownDefectPct)}
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardBody className="space-y-3">
                {monthsSeries.some((pt) => pt.items.length > 0) ? (
                  <>
                    {monthPresent.size > 1 && <ProductLegend names={colorNames} present={monthPresent} hasOther={monthOther} selected={shown} onSelect={setPick} />}
                    {shown && card.concrete && <CatLegend />}
                    <Bars items={monthItems} selected={data.day.slice(0, 7)} labelEvery={1} height={120} />
                  </>
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
                <span className="text-[11px] font-normal text-text-muted">{hasConv ? "· Бракаас, засвараас бэлэн болгосон · материал" : "· Энэ сард зарцуулсан материал"}</span>
              </button>
              {moreOpen && (
                <CardBody className="space-y-5 border-t border-border">
                  {hasConv && (
                    <div className="space-y-4">
                      <p className="text-xs text-text-muted">Комплектаци: бракаас, засвараас бэлэн болгосон (гарцын тоонд нэмэгдээгүй)</p>
                      <div className="overflow-hidden rounded-lg border border-border">
                        <p className="border-b border-border bg-white/[0.02] px-4 py-2 text-sm text-text">
                          {mnDate(data.day)}: <span className="ng-num">{convSummary(card.convDay)}</span>
                        </p>
                        {card.convDay.products.length > 0 ? <ConvProductLines products={card.convDay.products} /> : <p className="px-4 py-3 text-sm text-text-muted">Энэ өдөр шилжүүлэг байхгүй</p>}
                      </div>
                      <div className="overflow-hidden rounded-lg border border-border">
                        <p className="border-b border-border bg-white/[0.02] px-4 py-2 text-sm text-text">
                          {Number(data.day.slice(5, 7))}-р сар: <span className="ng-num">{convSummary(card.convMonth)}</span>
                        </p>
                        {card.convMonth.products.length > 0 ? (
                          <>
                            <ConvProductLines products={card.convMonth.products} />
                            <p className="border-y border-border px-4 py-1.5 text-[11px] text-text-muted">Өдрөөр</p>
                            <ConvDayLines days={card.convDays} />
                          </>
                        ) : (
                          <p className="px-4 py-3 text-sm text-text-muted">Энэ сард шилжүүлэг байхгүй</p>
                        )}
                      </div>
                    </div>
                  )}
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
