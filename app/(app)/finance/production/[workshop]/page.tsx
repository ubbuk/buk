"use client";

import { Suspense, useCallback, useState } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Factory } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorNote, FinanceShell } from "@/components/finance/FinanceShell";
import { Amount } from "@/components/finance/cash/Amount";
import { Bars, DayBar, dayBars, mnDate, num, ProductLines, qtyLine } from "@/components/finance/production/DirectorParts";
import { useFinanceData } from "@/components/finance/useFinanceData";
import { isDate } from "@/lib/onec/dates";
import type { WorkshopView } from "@/lib/onec/production-view";
import { unitName } from "@/lib/units";
import { cn } from "@/lib/utils";

const mmdd = (day: string) => `${day.slice(5, 7)}-${day.slice(8, 10)}`;

/** /finance/production/[цех]: цех бүрийн тусдаа хуудас. Өдрийн гарц, энэ сар, сүүлийн 12 сар, материал («Дэлгэрэнгүй»). */
function WorkshopPage() {
  const params = useParams<{ workshop: string }>();
  const name = (() => {
    try {
      return decodeURIComponent(params.workshop);
    } catch {
      return params.workshop;
    }
  })();
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const dayRaw = sp.get("day");
  const dayParam = isDate(dayRaw) ? dayRaw : null;
  const q = new URLSearchParams({ name });
  if (dayParam) q.set("day", dayParam);
  const { data, error } = useFinanceData<WorkshopView>(`/api/dashboard/production/workshop?${q}`);
  const setDay = useCallback((d: string | null) => router.replace(d ? `${pathname}?day=${d}` : pathname, { scroll: false }), [pathname, router]);
  const [moreOpen, setMoreOpen] = useState(false);
  const back = `/finance/production${dayParam ? `?day=${dayParam}` : ""}`;
  const card = data?.card ?? null;
  const unit = card?.unit ?? "";

  return (
    <FinanceShell title={name} subtitle="Цехийн өдөр, сарын гарц" icon={Factory} lastSyncedAt={data?.lastSyncedAt} notice={data?.scopeNote ? <ErrorNote message={data.scopeNote} /> : undefined} hideYm>
      <Link href={back} className="focus-ring inline-flex min-h-11 w-fit items-center rounded-xl border border-border px-4 text-sm text-text-muted hover:text-text">
        ← Бүх цех
      </Link>
      {error && <ErrorNote message={error} />}

      {!data ? (
        !error && (
          <>
            <Skeleton className="h-11 w-80 max-w-full rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
          </>
        )
      ) : (
        card && (
          <>
            <DayBar day={data.day} today={data.today} onDay={(d) => setDay(d === data.latestDay ? null : d)} />

            {/* Тэр өдөр */}
            <section className="rounded-xl border border-border bg-bg-surface shadow-card">
              <header className="border-b border-border px-5 py-3 text-sm font-semibold text-text">{mnDate(data.day)}</header>
              {card.day.length > 0 ? (
                <>
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-4">
                    {card.day.map((qt) => (
                      <span key={qt.unit} className="whitespace-nowrap">
                        <span className="ng-num text-4xl font-semibold leading-none text-text">{num(qt.qty)}</span>
                        <span className="ml-2 text-sm text-text-muted">{unitName(qt.unit)}</span>
                      </span>
                    ))}
                  </div>
                  <div className="border-t border-border">
                    <ProductLines products={card.products} />
                  </div>
                </>
              ) : (
                <p className="px-5 py-8 text-base text-text-muted">
                  Мэдээ ороогүй · Сүүлд: <span className="ng-num">{card.lastDay ? mmdd(card.lastDay) : "—"}</span>
                </p>
              )}
            </section>

            {/* Энэ сар */}
            <Card>
              <CardHeader>
                <CardTitle>
                  {Number(data.day.slice(5, 7))}-р сар · нийт <span className="ng-num ml-1 text-text">{qtyLine(card.month)}</span>
                </CardTitle>
              </CardHeader>
              <CardBody className="space-y-4">
                {card.monthQty > 0 ? (
                  <>
                    <Bars items={dayBars(card.monthDays, unit)} selected={data.day} onSelect={(d) => setDay(d === data.latestDay ? null : d)} height={120} />
                    <p className="text-[11px] text-text-muted">Өдрийн баганыг дарвал тэр өдрийн гарц дээр гарна.</p>
                  </>
                ) : (
                  <p className="text-sm text-text-muted">Энэ сард мэдээ ороогүй</p>
                )}
              </CardBody>
              {card.monthQty > 0 && (
                <div className="border-t border-border">
                  <p className="px-4 pt-3 text-xs text-text-muted">Бүтээгдэхүүнээр</p>
                  <ProductLines products={card.monthProducts} />
                </div>
              )}
            </Card>

            {/* Сүүлийн 12 сар */}
            <Card>
              <CardHeader>
                <CardTitle>Сүүлийн 12 сар{unit ? ` · ${unitName(unit)}` : ""}</CardTitle>
              </CardHeader>
              <CardBody>
                {data.months.some((m) => m.qty > 0) ? (
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
