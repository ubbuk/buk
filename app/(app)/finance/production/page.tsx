"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarClock, ChevronRight, Coins, Factory } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { DailyBarChart } from "@/components/finance/DailyBarChart";
import { ErrorNote, FinanceShell, connectionFrom } from "@/components/finance/FinanceShell";
import { Amount } from "@/components/finance/cash/Amount";
import { CardDetail, DayDetailView, MonthBar, ProductionGridView, ProductList, type DayState } from "@/components/finance/production/ProductionParts";
import { useFinanceData } from "@/components/finance/useFinanceData";
import { currentMonthUb } from "@/components/finance/useOnecRefresh";
import { isDate } from "@/lib/onec/dates";
import { resolveMonth } from "@/lib/onec/production-month";
import type { DaySection, ProductionView } from "@/lib/onec/production-view";
import { cn } from "@/lib/utils";
import { formatQuantity } from "@/lib/units";

const MN_MONTH = (m: string) => `${m.slice(0, 4)} оны ${Number(m.slice(5, 7))}-р сар`;
const axis = (v: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(v);

function ProductionPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const current = currentMonthUb();
  // URL: ?month=2026-11&day=2026-11-24&card=<цех>. month байхгүй/буруу бол ЗАВААЛ энэ сар.
  const month = resolveMonth(sp.get("month"), current);
  const dayRaw = sp.get("day");
  const day = isDate(dayRaw) && dayRaw.startsWith(month) ? dayRaw : null;
  const card = sp.get("card") || null;

  const url = useMemo(() => {
    const q = new URLSearchParams({ month });
    if (card) q.set("dept", card);
    return `/api/dashboard/production?${q}`;
  }, [month, card]);
  const { data, error } = useFinanceData<ProductionView>(url);

  const update = useCallback(
    (patch: { month?: string | null; day?: string | null; card?: string | null }) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      router.replace(`${pathname}?${next}`, { scroll: false });
    },
    [sp, pathname, router]
  );

  // Өдрийн задаргаа (нүд / өдрийн толгой дарахад л): баримтын дугаар, цаг зөвхөн энд
  const [detail, setDetail] = useState<Record<string, DayState>>({});
  const detailKey = day ? `${day}|${card ?? ""}` : null;
  useEffect(() => {
    if (!day || !detailKey) return;
    let live = true;
    const q = new URLSearchParams({ day });
    if (card) q.set("card", card);
    setDetail((d) => (d[detailKey] ? d : { ...d, [detailKey]: "loading" }));
    fetch(`/api/dashboard/production/day?${q}`)
      .then(async (r) => (r.ok ? ((await r.json()) as { day: string; sections: DaySection[] }) : Promise.reject(new Error(String(r.status)))))
      .then((body) => live && setDetail((d) => ({ ...d, [detailKey]: body })))
      .catch(() => live && setDetail((d) => ({ ...d, [detailKey]: "error" })));
    return () => {
      live = false;
    };
  }, [day, card, detailKey]);

  const [moreOpen, setMoreOpen] = useState(false);
  const monthNo = `${Number(month.slice(5, 7))}-р сар`;
  const selectedCard = data && card ? (data.cards.find((c) => c.name === card) ?? null) : null;
  const changeMonth = (m: string) => update({ month: m === current ? null : m, day: null });

  return (
    <FinanceShell
      title="Үйлдвэрлэл"
      subtitle="Цех бүр өдөр бүр хэдийг үйлдвэрлэв. Өгөгдөл 15 минут тутам шинэчлэгдэнэ"
      icon={Factory}
      lastSyncedAt={data?.lastSyncedAt}
      connection={connectionFrom(data?.lastSyncedAt)}
      notice={data?.scopeNote ? <ErrorNote message={data.scopeNote} /> : undefined}
      hideYm
    >
      {error && <ErrorNote message={error} />}

      <MonthBar month={month} current={current} onMonth={changeMonth} />

      {/* Цех × Өдөр */}
      {!data ? (
        <Skeleton className="h-72 rounded-xl" />
      ) : data.grid.rows.length === 0 ? (
        <Card>
          <CardBody className="py-10 text-center text-sm text-text-muted">{data.scopeNote ? "Харуулах цех алга" : "Үйлдвэрлэлийн баримт татагдаагүй байна. Өгөгдөл 15 минут тутам автоматаар шинэчлэгдэнэ."}</CardBody>
        </Card>
      ) : (
        <ProductionGridView
          grid={data.grid}
          today={data.todayDate}
          selectedDay={day}
          selectedCard={card}
          onCell={(c, d) => update({ day: day === d && card === c ? null : d, card: day === d && card === c ? null : c })}
          onDay={(d) => update({ day: day === d && !card ? null : d, card: null })}
          onCard={(c) => update({ card: card === c ? null : c, day: null })}
        />
      )}

      {/* Нүд / өдрийн толгойн задаргаа */}
      {day && detailKey && <DayDetailView day={day} card={card} state={detail[detailKey]} onClose={() => update({ day: null })} />}

      {/* Цех сонгоход л: цехийн дэлгэрэнгүй + сарын бүтээгдэхүүн + 12 сарын график */}
      {selectedCard && (
        <>
          <CardDetail card={selectedCard} onClear={() => update({ card: null, day: null })} />
          <Card>
            <CardHeader>
              <CardTitle>
                Бүтээгдэхүүн · {MN_MONTH(month)} · {selectedCard.name}
              </CardTitle>
            </CardHeader>
            <ProductList products={selectedCard.products} />
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Сүүлийн 12 сарын гарц · {selectedCard.name}</CardTitle>
            </CardHeader>
            <CardBody className="space-y-2">
              {data?.monthly ? (
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
        </>
      )}

      {/* Өртөг ба материал: «Дэлгэрэнгүй» (анхдагч хаалттай) */}
      <Card>
        <button
          type="button"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((v) => !v)}
          className="focus-ring flex min-h-14 w-full items-center gap-2 px-5 py-3 text-left text-sm font-semibold text-text hover:bg-white/[0.03]"
        >
          <ChevronRight aria-hidden className={cn("size-4 text-text-muted transition-transform", moreOpen && "rotate-90")} />
          Дэлгэрэнгүй
          <span className="text-[11px] font-normal text-text-muted">· Өртөг ба материал · {monthNo}</span>
        </button>
        {moreOpen && (
          <CardBody className="space-y-4 border-t border-border">
            {!data ? (
              <Skeleton className="h-40" />
            ) : (
              <>
                <div>
                  <p className="flex items-center gap-2 text-xs text-text-muted">
                    <Coins className="size-4 text-[#ffd56b]" aria-hidden /> Үйлдвэрлэлийн өртөг
                  </p>
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
        )}
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
