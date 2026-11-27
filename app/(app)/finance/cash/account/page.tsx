"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Landmark } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorNote, FinanceShell } from "@/components/finance/FinanceShell";
import { CashEntries, NO_FILTER, type CashEntryFilter } from "@/components/finance/cash/CashEntries";
import { PeriodNumbers, signedMoney } from "@/components/finance/cash/AccountParts";
import { DayBar } from "@/components/finance/production/DirectorParts";
import { useOdataData, type OdataMeta } from "@/components/finance/useOdataData";
import { RefreshButton } from "@/components/finance/useOnecRefresh";
import { isDate, isMonth, monthRange, today as todayUb } from "@/lib/onec/dates";
import type { AccountPeriod } from "@/lib/onec/cash-accounts";
import type { LastMove } from "@/lib/onec/cash-activity";
import { cn } from "@/lib/utils";

interface AccountResponse {
  account: { id: string; title: string; subtitle: string | null; kind: "bank" | "cash"; bank: string; last4: string; number?: string; currency: string };
  period: AccountPeriod;
  /** хугацаанд гүйлгээгүй үед: сүүлийн гүйлгээ (null = олдсонгүй); гүйлгээтэй бол байхгүй */
  lastMove?: LastMove | null;
  month: string;
  today: string;
  asOf: string;
  meta: OdataMeta;
}

/**
 * Нэг дансны хуудас. URL: ?id=<дансны ID>&day=2026-11-25 (нэг өдөр, анхдагч өнөөдөр) эсвэл &month=2026-11 («Энэ сар»).
 * Дөрвөн тоо (эхний, орсон, гарсан, эцсийн) ба тэр дансны гүйлгээ: «Бүх гүйлгээ»-тэй ИЖИЛ жагсаалт, зөвхөн энэ дансаар шүүгдэнэ.
 */
/** Хугацаанд гүйлгээгүй: «Энэ сард энэ данснаас гүйлгээ хийгдээгүй · Сүүлийн гүйлгээ: 2026-08-14 (+12.4 сая₮)» ба тэр сар руу очих товч */
function IdleNote({ mode, period, now, lastMove, onGo }: { mode: "day" | "month"; period: AccountPeriod; now: string; lastMove?: LastMove | null; onGo: (date: string) => void }) {
  const when = mode === "day" ? "Энэ өдөр" : period.from.slice(0, 7) === now.slice(0, 7) ? "Энэ сард" : `${Number(period.from.slice(5, 7))}-р сард`;
  return (
    <div className="space-y-3 px-4 py-8 text-center">
      <p className="text-sm text-text-muted">
        {when} энэ данснаас гүйлгээ хийгдээгүй
        {lastMove ? (
          <>
            {" · "}Сүүлийн гүйлгээ: <span className="ng-num text-text">{lastMove.date}</span> <span className={lastMove.amount < 0 ? "text-danger" : "text-success"}>({signedMoney(lastMove.amount)})</span>
          </>
        ) : lastMove === null ? (
          " · Өмнөх гүйлгээ олдсонгүй"
        ) : null}
      </p>
      {lastMove && (
        <button type="button" onClick={() => onGo(lastMove.date)} className="focus-ring ng-panel inline-flex min-h-11 items-center rounded-xl px-4 text-sm text-[#ffd56b] hover:bg-white/5">
          Сүүлийн гүйлгээ рүү очих
        </button>
      )}
    </div>
  );
}

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
  // «Энэ сар» горимд өдөр сонгогч сарын сүүлчийн (эсвэл өнөөдрийн) өдрийг заана
  const pseudoDay = mode === "day" ? day : month === now.slice(0, 7) ? now : monthRange(month).to;
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
        {/* Бусад табын өдөр сонгогчтой ИЖИЛ: ◀ огноо ▶, Өнөөдөр, Өчигдөр + «Энэ сар». «Энэ сар» үед өдрийн товчнууд тодрохгүй, дарахад өдрийн горим руу */}
        <DayBar day={pseudoDay} today={now} onDay={setDay} muted={mode === "month"} />
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
          <CashEntries
            month={data.month}
            filter={filter}
            onFilter={setFilter}
            version={data.meta.fetchedAt}
            accountId={data.account.id}
            from={data.period.from}
            to={data.period.to}
            emptyState={<IdleNote mode={mode} period={data.period} now={now} lastMove={data.lastMove} onGo={(date) => go({ month: date.slice(0, 7) })} />}
          />
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
