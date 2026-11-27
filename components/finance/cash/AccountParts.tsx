"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRight, Landmark, Wallet } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatMoneyFull, formatMoneyShort } from "@/lib/money-short";
import type { AccountCard, AccountCards, AccountPeriod } from "@/lib/onec/cash-accounts";
import type { LastMove } from "@/lib/onec/cash-activity";
import { cn } from "@/lib/utils";

// «Данснууд»: данс бүр нэг карт. Захирлын харагдац: дансны код, «1С», Комментарий байхгүй. Дансны бүтэн дугаар зөвхөн ADMIN-д (API өгнө), бусдад сүүлийн 4 орон.
// Картууд нэг баганатай (утсанд), хэвтээ гүйлгэлтгүй. Карт нь бүхэлдээ линк тул дотор нь товч (Amount) байхгүй.

const CURRENCY_SYMBOL: Record<string, string> = { USD: "$", EUR: "€", CNY: "¥", RUB: "₽", JPY: "¥" };

/** Валютын дүн: «$266,090», «€1,200», «5,988.75 CNY» (тэмдэггүй валют код дагуулна) */
export function fxText(value: number, currency: string): string {
  const n = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Math.abs(value));
  const sign = value < 0 ? "−" : "";
  const sym = CURRENCY_SYMBOL[currency];
  return sym && currency !== "CNY" && currency !== "RUB" ? `${sign}${sym}${n}` : `${sign}${n} ${currency}`;
}

/** «Өнөөдөр: орсон +12.4 сая₮ · гарсан −361.1 сая₮» */
export function todayLine(t: AccountCard["today"]): string {
  const inflow = t.inflow > 0 ? `+${formatMoneyShort(t.inflow)}` : "0₮";
  const outflow = t.outflow > 0 ? `−${formatMoneyShort(t.outflow)}` : "0₮";
  return `Өнөөдөр: орсон ${inflow} · гарсан ${outflow}`;
}

/** ₮ том тоо, валютын данс бол доор нь валютаар (эсвэл эсрэгээр: $ ба ₮ хоёулаа) */
export function Balance({ value, fx, currency, big = true }: { value: number; fx: number | null; currency: string; big?: boolean }) {
  return (
    <span className="block">
      {fx !== null ? (
        <>
          <span className={cn("ng-num block font-semibold leading-tight text-text", big ? "text-[26px]" : "text-lg")} title={formatMoneyFull(value)}>
            {fxText(fx, currency)}
          </span>
          <span className="ng-num block text-sm text-text-muted" title={formatMoneyFull(value)}>
            {formatMoneyShort(value)}
          </span>
        </>
      ) : (
        <span className={cn("ng-num block font-semibold leading-tight text-text", big ? "text-[26px]" : "text-lg")} title={formatMoneyFull(value)}>
          {formatMoneyShort(value)}
        </span>
      )}
    </span>
  );
}

/** «Хөдөлгөөнгүй · сүүлд 08-14» (сүүлийн гүйлгээ олдоогүй/хайж байгаа бол «Хөдөлгөөнгүй») */
export function idleLine(last: LastMove | null | undefined): string {
  return last ? `Хөдөлгөөнгүй · сүүлд ${last.date.slice(5)}` : "Хөдөлгөөнгүй";
}

/** «+12.4 сая₮» / «−361.1 мянга₮» (дансны талаас) */
export const signedMoney = (v: number): string => `${v > 0 ? "+" : ""}${formatMoneyShort(v)}`;

export function accountHref(id: string): string {
  return `/finance/cash/account?id=${encodeURIComponent(id)}`;
}

/** `idle`: энэ сард хөдөлгөөнгүй данс: «Өнөөдөр: …» мөрийн оронд саарал «Хөдөлгөөнгүй · сүүлд 08-14» (`last` = сүүлийн гүйлгээ, хайж дуустал undefined) */
export function AccountCardView({ card, idle = false, last }: { card: AccountCard; idle?: boolean; last?: LastMove | null }) {
  const Icon = card.kind === "cash" ? Wallet : Landmark;
  return (
    <li>
      <Link href={accountHref(card.id)} className="focus-ring flex h-full min-h-[8.5rem] w-full flex-col gap-2 rounded-xl border border-border bg-bg-surface p-4 text-left shadow-card transition-colors hover:bg-white/[0.04]">
        <span className="flex items-start gap-2.5">
          <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-[#ffd56b]" />
          <span className="min-w-0">
            <span className={cn("block break-words text-text", card.subtitle ? "text-base font-semibold" : "text-sm font-medium")}>{card.title}</span>
            {card.subtitle && <span className="block break-words text-xs text-text-muted">{card.subtitle}</span>}
            {card.number && <span className="ng-num block break-all text-[11px] text-text-muted">№ {card.number}</span>}
          </span>
        </span>
        <Balance value={card.closing} fx={card.closingFx} currency={card.currency} />
        <span className={cn("mt-auto text-xs", idle ? "text-text-muted/70" : "text-text-muted")}>{idle ? idleLine(last) : todayLine(card.today)}</span>
      </Link>
    </li>
  );
}

/** Табын дээд хэсэг: бүх дансны нийт үлдэгдэл (₮) ба данс бүрийн карт */
export function AccountsSection({ data, loading, error, manageHref, initiallyOpen = false }: { data: AccountCards | null; loading: boolean; error: string | null; manageHref?: string; /** «Хөдөлгөөнгүй данс» нээлттэй эхлэх (анхдагч хаалттай; тестэд) */ initiallyOpen?: boolean }) {
  const [idleOpen, setIdleOpen] = useState(initiallyOpen);
  const active = data?.accounts.filter((c) => c.active) ?? [];
  const idle = data?.accounts.filter((c) => !c.active) ?? [];
  return (
    <section aria-label="Данснууд" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div>
          <h2 className="text-sm font-semibold text-text">Данснууд</h2>
          {data && (
            <p className="text-xs text-text-muted">
              Нийт үлдэгдэл · {data.asOf}
              {data.hiddenCount > 0 ? ` · нуусан ${data.hiddenCount} данс орсон` : ""}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-baseline justify-end gap-x-3 gap-y-1">
          {manageHref && (
            <Link href={manageHref} className="focus-ring text-xs text-text-muted underline hover:text-text">
              Нэр, дараалал тохируулах
            </Link>
          )}
          {data && (
            <span className="ng-num whitespace-nowrap text-2xl font-semibold text-text sm:text-3xl" title={formatMoneyFull(data.total)}>
              {formatMoneyShort(data.total)}
            </span>
          )}
        </div>
      </div>
      {error && !data && <p className="text-sm text-text-muted">{error}</p>}
      {loading && !data ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      ) : data ? (
        <>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {active.map((c) => (
              <AccountCardView key={c.id} card={c} />
            ))}
          </ul>
          {active.length === 0 && <p className="text-sm text-text-muted">Энэ сард гүйлгээтэй данс алга</p>}
          {idle.length > 0 && (
            <div className="space-y-3">
              <button type="button" aria-expanded={idleOpen} onClick={() => setIdleOpen((v) => !v)} className="focus-ring flex min-h-11 w-full items-center gap-2 rounded-xl border border-border px-4 text-left text-sm font-medium text-text hover:bg-white/[0.03]">
                <ChevronRight aria-hidden className={cn("size-4 text-text-muted transition-transform", idleOpen && "rotate-90")} />
                Хөдөлгөөнгүй данс ({idle.length})
                <span className="ml-auto text-xs font-normal text-text-muted">энэ сард гүйлгээгүй, нийт үлдэгдэлд орсон</span>
              </button>
              {idleOpen && (
                <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {idle.map((c) => (
                    <AccountCardView key={c.id} card={c} idle last={c.lastMove} />
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}

const money = (v: number) => formatMoneyShort(v);

/** Нэг дансны сонгосон хугацааны дөрвөн тоо. Валютын данс бол валютаар нь мөн харуулна. */
export function PeriodNumbers({ period, currency }: { period: AccountPeriod; currency: string }) {
  const cell = (label: string, value: number, fx: number | undefined, tone?: "in" | "out", sign = "") => (
    <div className="rounded-2xl border border-border bg-bg-surface px-4 py-3.5 shadow-card">
      <p className="text-xs text-text-muted">{label}</p>
      <p className={cn("ng-num mt-1 whitespace-nowrap text-xl font-semibold leading-tight sm:text-2xl", tone === "in" ? "text-success" : tone === "out" ? "text-danger" : "text-text")} title={formatMoneyFull(value)}>
        {value === 0 ? "0₮" : `${sign}${money(value)}`}
      </p>
      {fx !== undefined && <p className="ng-num mt-0.5 text-sm text-text-muted">{fxText(fx, currency)}</p>}
    </div>
  );
  const fx = period.fx;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cell("Эхний үлдэгдэл", period.opening, fx?.opening)}
        {cell("Орсон", period.inflow, fx?.inflow, "in", "+")}
        {cell("Гарсан", period.outflow, fx?.outflow, "out", "−")}
        {cell("Эцсийн үлдэгдэл", period.closing, fx?.closing)}
      </div>
      {(period.transfersIn > 0 || period.transfersOut > 0) && (
        <p className="text-xs text-text-muted">
          Орсон, гарсанд өөр данснаас шилжүүлсэн {money(period.transfersIn)}, өөр данс руу шилжүүлсэн {money(period.transfersOut)} багтсан
        </p>
      )}
    </div>
  );
}
