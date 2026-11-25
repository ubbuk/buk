"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Landmark } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorNote, FinanceShell } from "@/components/finance/FinanceShell";
import { CashEntries, NO_FILTER, type CashEntryFilter } from "@/components/finance/cash/CashEntries";
import { PeriodNumbers } from "@/components/finance/cash/AccountParts";
import { DayBar } from "@/components/finance/production/DirectorParts";
import { useOdataData, type OdataMeta } from "@/components/finance/useOdataData";
import { RefreshButton } from "@/components/finance/useOnecRefresh";
import { isDate, isMonth, today as todayUb } from "@/lib/onec/dates";
import type { AccountPeriod } from "@/lib/onec/cash-accounts";
import { cn } from "@/lib/utils";

interface AccountResponse {
  account: { id: string; title: string; subtitle: string | null; kind: "bank" | "cash"; bank: string; last4: string; number?: string; currency: string };
  period: AccountPeriod;
  month: string;
  today: string;
  asOf: string;
  meta: OdataMeta;
}

/**
 * Нэг дансны хуудас. URL: ?id=<дансны ID>&day=2026-11-25 (нэг өдөр, анхдагч өнөөдөр) эсвэл &month=2026-11 («Энэ сар»).
 * Дөрвөн тоо (эхний, орсон, гарсан, эцсийн) ба тэр дансны гүйлгээ: «Бүх гүйлгээ»-тэй ИЖИЛ жагсаалт, зөвхөн энэ дансаар шүүгдэнэ.
 */
function AccountPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const now = useMemo(() => todayUb(), []);
  const id = sp.get("id") ?? "";
  const dayRaw = sp.get("day");
  const monthRaw = sp.get("month");
  const mode: "day" | "month" = isMonth(monthRaw) ? "month" : "day";
  const day = isDate(dayRaw) && dayRaw <= now ? dayRaw : now;
  const month = isMonth(monthRaw) ? monthRaw : now.slice(0, 7);

  const apiUrl = `/api/dashboard/cash/account?id=${encodeURIComponent(id)}&${mode === "month" ? `month=${month}` : `day=${day}`}`;
  const { data, error, loading, retryAt, refresh } = useOdataData<AccountResponse>(apiUrl);
  const [filter, setFilter] = useState<CashEntryFilter>(NO_FILTER);
  useEffect(() => setFilter(NO_FILTER), [id, mode, day, month]);

  const go = useCallback((q: Record<string, string>) => router.replace(`${pathname}?${new URLSearchParams({ id, ...q })}`, { scroll: false }), [id, pathname, router]);
  const setDay = (d: string) => go(d === now ? {} : { day: d });
  const chip = cn("focus-ring ng-panel h-11 rounded-xl px-3.5 text-sm", mode === "month" ? "border-[rgba(255,213,107,0.6)] text-[#ffd56b]" : "text-text-muted hover:text-text");
  const acc = data?.account;

  return (
    <FinanceShell
      title={acc?.title ?? "Данс"}
      subtitle={acc ? (acc.subtitle ?? "Дансны орсон, гарсан, үлдэгдэл") : "Дансны орсон, гарсан, үлдэгдэл"}
      icon={Landmark}
      lastSyncedAt={data?.meta.fetchedAt}
      connection={error || data?.meta.stale ? "offline" : data ? "ok" : null}
      refresh={<RefreshButton busy={loading} retryAt={retryAt} onClick={refresh} />}
      hideYm
    >
      <Link href="/finance/cash" className="focus-ring inline-flex min-h-11 w-fit items-center rounded-xl border border-border px-4 text-sm text-text-muted hover:text-text">
        ← Бүх данс
      </Link>
      {!id && <ErrorNote message="Данс сонгоогүй байна" />}
      {error && <ErrorNote message={data ? `${error}. Сүүлд татсан өгөгдлийг харуулж байна.` : error} />}

      <div className="flex flex-wrap items-center gap-2.5">
        {mode === "day" ? (
          <DayBar day={day} today={now} onDay={setDay} />
        ) : (
          <button type="button" className="focus-ring ng-panel h-11 rounded-xl px-3.5 text-sm text-text-muted hover:text-text" onClick={() => setDay(now)}>
            ◀ Өдөр сонгох
          </button>
        )}
        <button type="button" aria-pressed={mode === "month"} className={chip} onClick={() => go({ month: mode === "month" ? now.slice(0, 7) : month })}>
          Энэ сар
        </button>
      </div>

      {!data && loading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      ) : data ? (
        <>
          <PeriodNumbers period={data.period} currency={data.account.currency} />
          <CashEntries month={data.month} filter={filter} onFilter={setFilter} version={data.meta.fetchedAt} accountId={data.account.id} from={data.period.from} to={data.period.to} />
        </>
      ) : null}
    </FinanceShell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <AccountPage />
    </Suspense>
  );
}
