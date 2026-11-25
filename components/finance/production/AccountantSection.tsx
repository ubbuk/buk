"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Coins } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorNote } from "@/components/finance/FinanceShell";
import { Amount } from "@/components/finance/cash/Amount";
import { DayDetailView, MonthBar, ProductionGridView, type DayState } from "@/components/finance/production/ProductionParts";
import { workshopHref } from "@/components/finance/production/DirectorParts";
import { useFinanceData } from "@/components/finance/useFinanceData";
import { currentMonthUb } from "@/components/finance/useOnecRefresh";
import type { DaySection, ProductionView } from "@/lib/onec/production-view";

/**
 * «Дэлгэрэнгүй (нягтлангийн хүснэгт)»: Цех × Өдөр хүснэгт, хагас боловсруулсан цехүүд, нягтлан батлаагүй цэг, баримтын дугаар, өртөг ба материал.
 * Нээгдсэн үед л ачаална (анхдагч хаалттай). Сар, өдөр, цехийн сонголт энд дотооддоо (URL-ийн ?day= захирлын харагдацынх).
 */
export function AccountantSection() {
  const router = useRouter();
  const current = currentMonthUb();
  const [month, setMonth] = useState(current);
  const [sel, setSel] = useState<{ day: string; card: string | null } | null>(null);
  const { data, error } = useFinanceData<ProductionView>(`/api/dashboard/production?month=${month}`);

  const [detail, setDetail] = useState<Record<string, DayState>>({});
  const key = sel ? `${sel.day}|${sel.card ?? ""}` : null;
  useEffect(() => {
    if (!sel || !key) return;
    let live = true;
    const q = new URLSearchParams({ day: sel.day });
    if (sel.card) q.set("card", sel.card);
    setDetail((d) => (d[key] ? d : { ...d, [key]: "loading" }));
    fetch(`/api/dashboard/production/day?${q}`)
      .then(async (r) => (r.ok ? ((await r.json()) as { day: string; sections: DaySection[] }) : Promise.reject(new Error(String(r.status)))))
      .then((body) => live && setDetail((d) => ({ ...d, [key]: body })))
      .catch(() => live && setDetail((d) => ({ ...d, [key]: "error" })));
    return () => {
      live = false;
    };
  }, [sel, key]);

  const monthNo = `${Number(month.slice(5, 7))}-р сар`;
  return (
    <div className="space-y-4">
      {error && <ErrorNote message={error} />}
      <MonthBar
        month={month}
        current={current}
        onMonth={(m) => {
          setMonth(m);
          setSel(null);
        }}
      />
      {!data ? (
        <Skeleton className="h-72 rounded-xl" />
      ) : data.grid.rows.length === 0 ? (
        <Card>
          <CardBody className="py-10 text-center text-sm text-text-muted">Харуулах цех алга</CardBody>
        </Card>
      ) : (
        <ProductionGridView
          grid={data.grid}
          today={data.todayDate}
          selectedDay={sel?.day ?? null}
          selectedCard={sel?.card ?? null}
          onCell={(c, d) => setSel(sel?.day === d && sel.card === c ? null : { day: d, card: c })}
          onDay={(d) => setSel(sel?.day === d && !sel.card ? null : { day: d, card: null })}
          onCard={(c) => router.push(workshopHref(c))}
        />
      )}
      {sel && key && <DayDetailView day={sel.day} card={sel.card} state={detail[key]} onClose={() => setSel(null)} />}

      <Card>
        <CardBody className="space-y-4">
          {!data ? (
            <Skeleton className="h-24" />
          ) : (
            <>
              <div>
                <p className="flex items-center gap-2 text-xs text-text-muted">
                  <Coins className="size-4 text-[#ffd56b]" aria-hidden /> Үйлдвэрлэлийн өртөг · {monthNo}
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
      </Card>
    </div>
  );
}
