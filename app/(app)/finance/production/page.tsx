"use client";

import { Suspense, useCallback, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Factory } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorNote, FinanceShell } from "@/components/finance/FinanceShell";
import { AccountantSection } from "@/components/finance/production/AccountantSection";
import { CardDayDetail, DayBar, MonthProgress, TotalLine, WorkshopCards } from "@/components/finance/production/DirectorParts";
import { useFinanceData } from "@/components/finance/useFinanceData";
import { isDate } from "@/lib/onec/dates";
import type { DirectorView } from "@/lib/onec/production-view";
import { cn } from "@/lib/utils";

/**
 * Захирлын харагдац: «Тэр өдөр юу хийсэн бэ?» (өдөр сонгогч, нийт, цехийн картууд) ба «Энэ сар хэр явж байна?» (сарын явц).
 * URL: ?day=2026-11-18 (байхгүй бол гарцтай хамгийн сүүлийн өдөр), ?card=<цех> (сонгосон карт). Нягтлангийн хүснэгт хамгийн доор, анхдагч хаалттай.
 */
function ProductionPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const dayRaw = sp.get("day");
  const dayParam = isDate(dayRaw) ? dayRaw : null;
  const card = sp.get("card") || null;
  const { data, error } = useFinanceData<DirectorView>(`/api/dashboard/production/director${dayParam ? `?day=${dayParam}` : ""}`);

  const update = useCallback(
    (patch: { day?: string | null; card?: string | null }) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      const q = next.toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [sp, pathname, router]
  );
  const [moreOpen, setMoreOpen] = useState(false);
  const toggleCard = (name: string) => update({ card: card === name ? null : name });
  const selected = data && card ? (data.cards.find((c) => c.name === card) ?? null) : null;

  return (
    <FinanceShell title="Үйлдвэрлэл" subtitle="Цех бүр өдөр бүр юу үйлдвэрлэв. Өгөгдөл 15 минут тутам шинэчлэгдэнэ" icon={Factory} lastSyncedAt={data?.lastSyncedAt} notice={data?.scopeNote ? <ErrorNote message={data.scopeNote} /> : undefined} hideYm>
      {error && <ErrorNote message={error} />}

      {!data ? (
        <>
          <Skeleton className="h-11 w-80 max-w-full rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </>
      ) : (
        <>
          <DayBar day={data.day} today={data.today} onDay={(d) => update({ day: d === data.latestDay ? null : d, card: null })} />
          <TotalLine total={data.total} worked={data.worked} />
          {data.cards.length === 0 ? (
            <Card>
              <p className="px-5 py-10 text-center text-sm text-text-muted">Харуулах цех алга</p>
            </Card>
          ) : (
            <WorkshopCards cards={data.cards} selected={card} onSelect={toggleCard} />
          )}
          {selected && <CardDayDetail card={selected} day={data.day} onClose={() => update({ card: null })} />}
          {data.cards.length > 0 && <MonthProgress cards={data.cards} month={data.month} day={data.day} selected={card} onSelect={toggleCard} />}
        </>
      )}

      {/* Нягтлангийн хүснэгт: анхдагч хаалттай, нээгдэх үед л ачаална */}
      <Card>
        <button
          type="button"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((v) => !v)}
          className="focus-ring flex min-h-14 w-full items-center gap-2 px-5 py-3 text-left text-sm font-semibold text-text hover:bg-white/[0.03]"
        >
          <ChevronRight aria-hidden className={cn("size-4 text-text-muted transition-transform", moreOpen && "rotate-90")} />
          Дэлгэрэнгүй (нягтлангийн хүснэгт) →
        </button>
        {moreOpen && (
          <div className="border-t border-border p-4 sm:p-5">
            <AccountantSection />
          </div>
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
