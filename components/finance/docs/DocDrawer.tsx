"use client";

import { ArrowLeft, ChevronDown, Package, Warehouse, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Skeleton } from "@/components/ui/Skeleton";
import { addMonths, today } from "@/lib/onec/dates";
import type { DocDetail, ItemHistory } from "@/lib/onec/doc-kinds";
import { cn } from "@/lib/utils";
import { mono } from "../fonts";
import { useFinanceData } from "../useFinanceData";
import { OnecError, ToneIcon } from "./DocParts";
import { dayOf, money2, qty, stamp } from "./format";

// Баримтын drawer: нийт -> бүлэг -> баримтын жагсаалт -> баримт -> бараа дарахад барааны түүх. Дотроо дараалан нээгдэж, «Буцах» товчтой.
// Утсан дээр бүтэн дэлгэц, том дэлгэц дээр баруун талд самбар. Бүх өгөгдөл 1С-ээс УНШИГДАНА (бичихгүй).
export type DrawerView = { kind: "doc"; type: string; ref: string } | { kind: "item"; code?: string; key?: string; name?: string };

interface DrawerApi {
  openDoc: (type: string, ref: string) => void;
  openItem: (item: { code?: string; key?: string; name?: string }) => void;
}

const Ctx = createContext<DrawerApi | null>(null);

/** Drawer нээх функцүүд. DocDrawerProvider-ийн гадна дуудвал юу ч хийхгүй (тестэд аюулгүй) */
export function useDocDrawer(): DrawerApi {
  return useContext(Ctx) ?? { openDoc: () => {}, openItem: () => {} };
}

export function DocDrawerProvider({ children }: { children: React.ReactNode }) {
  const [stack, setStack] = useState<DrawerView[]>([]);
  const push = useCallback((v: DrawerView) => setStack((s) => [...s, v]), []);
  const api = useMemo<DrawerApi>(
    () => ({
      // «Цалин олголт (нэгтгэсэн)» мөрөнд баримт байхгүй (type, ref хоосон)
      openDoc: (type, ref) => {
        if (type && ref) push({ kind: "doc", type, ref });
      },
      openItem: (item) => push({ kind: "item", ...item }),
    }),
    [push]
  );
  const close = useCallback(() => setStack([]), []);
  const back = useCallback(() => setStack((s) => s.slice(0, -1)), []);
  const view = stack[stack.length - 1];

  return (
    <Ctx.Provider value={api}>
      {children}
      {view && <DrawerShell onClose={close} onBack={stack.length > 1 ? back : undefined} view={view} onOpen={api} />}
    </Ctx.Provider>
  );
}

function DrawerShell({ view, onClose, onBack, onOpen }: { view: DrawerView; onClose: () => void; onBack?: () => void; onOpen: DrawerApi }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // арын хуудас гүйхгүй
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className={cn(mono.variable, "fixed inset-0 z-[60] flex justify-end")} style={{ ["--ng-line" as string]: "rgba(80,140,240,0.4)" }}>
      <button type="button" aria-label="Хаах" onClick={onClose} className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm max-sm:hidden" tabIndex={-1} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={view.kind === "doc" ? "Баримт" : "Барааны түүх"}
        data-testid="doc-drawer"
        className="relative z-10 flex h-full w-full flex-col overflow-hidden border-l border-[rgba(80,140,240,0.4)] bg-[linear-gradient(180deg,#071634_0%,#040b1a_100%)] text-text shadow-[-20px_0_60px_-20px_rgba(40,110,240,0.5)] sm:max-w-[720px]"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-[rgba(80,140,240,0.3)] px-3 py-2.5 sm:px-5">
          {onBack ? (
            <button type="button" onClick={onBack} className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm text-text-muted hover:bg-white/5 hover:text-text">
              <ArrowLeft className="size-4" aria-hidden />
              Буцах
            </button>
          ) : (
            <span className="px-2 text-xs uppercase tracking-wider text-text-muted">{view.kind === "doc" ? "Баримт" : "Барааны түүх"}</span>
          )}
          <button type="button" onClick={onClose} aria-label="Хаах" className="focus-ring ml-auto inline-flex size-9 items-center justify-center rounded-lg text-text-muted hover:bg-white/5 hover:text-text">
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-8 pt-4 sm:px-5">
          {view.kind === "doc" ? <DocView type={view.type} refKey={view.ref} onOpen={onOpen} /> : <ItemView item={view} onOpen={onOpen} />}
        </div>
      </aside>
    </div>,
    document.body
  );
}

function Loading() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Ачаалж байна">
      <Skeleton className="h-14 rounded-xl" />
      <Skeleton className="h-24 rounded-xl" />
      <Skeleton className="h-40 rounded-xl" />
    </div>
  );
}

// ------------------------------------------------------------------ баримт

/** 1С-ийн баримтын дэлгэцтэй адил: толгой (дугаар, огноо, харилцагч, агуулах, хариуцагч), тайлбар, мөрүүд (бараа × тоо × үнэ = дүн), НӨАТ, нийт */
function DocView({ type, refKey, onOpen }: { type: string; refKey: string; onOpen: DrawerApi }) {
  const { data, error, loading, reload } = useFinanceData<DocDetail>(`/api/dashboard/documents/detail?type=${encodeURIComponent(type)}&ref=${refKey}`);
  if (loading && !data) return <Loading />;
  if (!data) return <OnecError message={error ?? "Баримт олдсонгүй"} onRetry={reload} />;
  const hasVat = data.totals.vat > 0 || data.totals.vatIncluded !== null;

  return (
    <div className="space-y-4">
      <header className="flex items-start gap-3">
        <ToneIcon tone={data.tone} size="lg" />
        <div className="min-w-0">
          <h2 className="text-lg font-semibold leading-tight text-text">
            {data.label} <span className="ng-num">№ {data.number}</span>
          </h2>
          <p className="ng-num mt-1 text-sm text-text-muted">{stamp(data.date)}</p>
          <span className={cn("mt-1.5 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium", data.posted ? "border-success/40 bg-success/10 text-success" : "border-warning/40 bg-warning/10 text-warning")}>{data.posted ? "Батлагдсан" : "Батлагдаагүй"}</span>
        </div>
      </header>
      {error && <OnecError message={error} onRetry={reload} />}

      {data.fields.length > 0 && (
        <dl className="ng-panel grid grid-cols-1 gap-x-6 gap-y-2.5 rounded-xl p-4 text-sm sm:grid-cols-2">
          {data.fields.map((f) => (
            <div key={f.label} className="min-w-0">
              <dt className="text-[11px] uppercase tracking-wide text-text-muted">{f.label}</dt>
              <dd className="mt-0.5 break-words text-text">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {data.comment && (
        <div className="ng-panel rounded-xl p-4 text-sm">
          <p className="text-[11px] uppercase tracking-wide text-text-muted">Тайлбар</p>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-text">{data.comment}</p>
        </div>
      )}

      {data.lines.length > 0 && (
        <section aria-label="Мөрүүд" className="ng-panel overflow-hidden rounded-xl">
          {/* том дэлгэц: 1С-ийн хүснэгт */}
          <table className="hidden w-full text-sm sm:table">
            <thead>
              <tr className="border-b border-[rgba(80,140,240,0.3)] text-[11px] uppercase tracking-wide text-text-muted">
                <th className="w-8 px-3 py-2 text-left font-medium">№</th>
                <th className="px-2 py-2 text-left font-medium">Бараа</th>
                <th className="px-2 py-2 text-right font-medium">Тоо</th>
                <th className="px-2 py-2 text-left font-medium">Нэгж</th>
                <th className="px-2 py-2 text-right font-medium">Үнэ</th>
                <th className="px-2 py-2 text-right font-medium">Дүн</th>
                {hasVat && <th className="px-3 py-2 text-right font-medium">НӨАТ</th>}
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l) => (
                <tr key={l.n} className="border-b border-[rgba(80,140,240,0.14)] last:border-0">
                  <td className="ng-num px-3 py-2 text-text-muted">{l.n}</td>
                  <td className="px-2 py-2">
                    <ItemButton line={l} onOpen={onOpen} />
                  </td>
                  <td className="ng-num px-2 py-2 text-right">{qty(l.qty)}</td>
                  <td className="px-2 py-2 text-text-muted">{l.unit}</td>
                  <td className="ng-num px-2 py-2 text-right">{money2(l.price)}</td>
                  <td className="ng-num px-2 py-2 text-right text-text">{money2(l.amount)}</td>
                  {hasVat && <td className="ng-num px-3 py-2 text-right text-text-muted">{money2(l.vat)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          {/* утас: мөр бүр нэг карт */}
          <ul className="divide-y divide-[rgba(80,140,240,0.18)] sm:hidden">
            {data.lines.map((l) => (
              <li key={l.n} className="space-y-1 px-3.5 py-3">
                <div className="flex items-start gap-2">
                  <span className="ng-num mt-0.5 text-xs text-text-muted">{l.n}.</span>
                  <ItemButton line={l} onOpen={onOpen} />
                </div>
                <p className="ng-num pl-5 text-xs text-text-muted">
                  {qty(l.qty)} {l.unit} × {money2(l.price)}
                </p>
                <p className="ng-num pl-5 text-sm text-text">
                  {money2(l.amount)}
                  {hasVat && l.vat > 0 && <span className="ml-2 text-xs text-text-muted">НӨАТ {money2(l.vat)}</span>}
                </p>
              </li>
            ))}
          </ul>
          {data.costFromLedger && <p className="border-t border-[rgba(80,140,240,0.3)] px-3.5 py-2 text-[11px] text-text-muted">Энэ баримт өртөг хадгалдаггүй тул үнэ, дүнг 1С-ийн нягтлан бодох бүртгэлээс (өртгөөр) авсан.</p>}
        </section>
      )}

      <section aria-label="Нийт" className="ng-panel ml-auto w-full rounded-xl p-4 text-sm sm:max-w-sm">
        {data.lines.length > 0 && <Row label="Мөрийн тоо" value={String(data.lines.length)} />}
        {data.lines.length > 0 && data.totals.vatIncluded !== null && <Row label={data.totals.vatIncluded ? "Дүн (НӨАТ-тай)" : "Дүн (НӨАТ-гүй)"} value={money2(data.totals.amount)} />}
        {data.totals.vat > 0 && <Row label={data.totals.vatIncluded ? "Үүнээс НӨАТ" : "НӨАТ"} value={money2(data.totals.vat)} />}
        <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-[rgba(80,140,240,0.3)] pt-2.5">
          <span className="text-text-muted">Нийт</span>
          <span className="ng-num text-xl font-semibold text-[#ffd56b]" data-testid="doc-total">
            {money2(data.totals.total)}
          </span>
        </div>
      </section>

      {data.postings.length > 0 && (
        <details className="ng-panel group rounded-xl">
          <summary className="focus-ring flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-4 py-3 text-sm font-medium text-text">
            Бүртгэлийн бичилт ({data.postings.length})
            <ChevronDown className="size-4 text-text-muted transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="overflow-x-auto px-1 pb-3">
            <table className="w-full min-w-[480px] text-xs">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-text-muted">
                  <th className="px-3 py-1.5 text-left font-medium">Дебит данс</th>
                  <th className="px-2 py-1.5 text-left font-medium">Кредит данс</th>
                  <th className="px-3 py-1.5 text-right font-medium">Дүн</th>
                </tr>
              </thead>
              <tbody>
                {data.postings.map((p) => (
                  <tr key={p.n} className="border-t border-[rgba(80,140,240,0.14)]">
                    <td className="px-3 py-1.5" title={p.debit.code ? `Данс ${p.debit.code}` : undefined}>
                      {p.debit.name}
                    </td>
                    <td className="px-2 py-1.5" title={p.credit.code ? `Данс ${p.credit.code}` : undefined}>
                      {p.credit.name}
                    </td>
                    <td className="ng-num px-3 py-1.5 text-right">{money2(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-0.5">
      <span className="text-text-muted">{label}</span>
      <span className="ng-num text-text">{value}</span>
    </div>
  );
}

/** Барааны нэр: дарахад тэр барааны түүх нээгдэнэ */
function ItemButton({ line, onOpen }: { line: DocDetail["lines"][number]; onOpen: DrawerApi }) {
  if (!line.itemKey) return <span className="text-text">{line.item}</span>;
  return (
    <button type="button" onClick={() => onOpen.openItem({ key: line.itemKey, name: line.item })} className="focus-ring min-w-0 rounded text-left text-text underline decoration-[rgba(255,213,107,0.45)] decoration-dotted underline-offset-4 hover:text-[#ffd56b]" title="Барааны түүх харах">
      {line.item}
    </button>
  );
}

// ------------------------------------------------------------------ барааны түүх

/** Барааны түүх: энэ бараа ямар баримтаар, ямар агуулахад хэзээ орж, гарсан + агуулах бүрийн одоогийн үлдэгдэл. Баримт дээр дарахад баримт нээгдэнэ. */
function ItemView({ item, onOpen }: { item: Extract<DrawerView, { kind: "item" }>; onOpen: DrawerApi }) {
  const [monthsBack, setMonthsBack] = useState(1); // одоогийн сар + өмнөх 1 сар; «Өмнөх сар нэмэх» ихдээ 6 сар
  const to = today();
  const from = `${addMonths(to.slice(0, 7), -monthsBack)}-01`;
  const id = item.key ? `key=${item.key}` : `code=${encodeURIComponent(item.code ?? "")}`;
  const { data, error, loading, reload } = useFinanceData<ItemHistory & { balances: { warehouse: string; qty: number; amount: number }[] }>(`/api/dashboard/documents/item?${id}&from=${from}&to=${to}`);
  const title = data?.item || item.name || "Бараа";

  return (
    <div className="space-y-4">
      <header className="flex items-start gap-3">
        <span aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-[rgba(255,213,107,0.5)] bg-[linear-gradient(160deg,rgba(245,181,35,0.22),rgba(245,181,35,0.04))] text-[#ffd56b]">
          <Package className="size-6" />
        </span>
        <div className="min-w-0">
          <h2 className="break-words text-lg font-semibold leading-tight text-text">{title}</h2>
          <p className="mt-1 text-xs text-text-muted">
            {data?.itemCode && <span className="ng-num">Код {data.itemCode}</span>}
            {data?.unit && <span> · {data.unit}</span>}
          </p>
        </div>
      </header>

      {loading && !data && <Loading />}
      {error && <OnecError message={error} onRetry={reload} />}

      {data && (
        <>
          <section aria-label="Агуулах бүрийн үлдэгдэл" className="ng-panel rounded-xl p-4">
            <h3 className="flex items-center gap-2 text-sm font-medium text-text">
              <Warehouse className="size-4 text-[#ffd56b]" aria-hidden />
              Агуулах бүрийн одоогийн үлдэгдэл
            </h3>
            {data.balances.length === 0 ? (
              <p className="mt-2 text-sm text-text-muted">Одоогоор үлдэгдэлгүй.</p>
            ) : (
              <ul className="mt-2 divide-y divide-[rgba(80,140,240,0.18)]">
                {data.balances.map((b) => (
                  <li key={b.warehouse} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2 text-sm">
                    <span className="min-w-0 break-words text-text">{b.warehouse}</span>
                    <span className="ng-num text-text">
                      {qty(b.qty)} {data.unit} <span className="ml-2 text-text-muted">{money2(b.amount)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Хөдөлгөөн" className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-text">
                Хөдөлгөөн <span className="ng-num text-xs font-normal text-text-muted">{data.from} — {data.to}</span>
              </h3>
              {monthsBack < 6 && (
                <button type="button" onClick={() => setMonthsBack((m) => Math.min(6, m + 2))} className="focus-ring h-8 rounded-lg border border-[rgba(80,140,240,0.4)] px-3 text-xs text-text-muted hover:text-text">
                  Өмнөх саруудыг нэмэх
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="ng-panel rounded-xl p-3">
                <p className="text-[11px] uppercase tracking-wide text-success">Орсон</p>
                <p className="ng-num mt-0.5 text-text">{qty(data.totals.inQty)} {data.unit}</p>
                <p className="ng-num text-xs text-text-muted">{money2(data.totals.inAmount)}</p>
              </div>
              <div className="ng-panel rounded-xl p-3">
                <p className="text-[11px] uppercase tracking-wide text-danger">Гарсан</p>
                <p className="ng-num mt-0.5 text-text">{qty(data.totals.outQty)} {data.unit}</p>
                <p className="ng-num text-xs text-text-muted">{money2(data.totals.outAmount)}</p>
              </div>
            </div>
            {data.rows.length === 0 ? (
              <p className="ng-panel rounded-xl p-4 text-sm text-text-muted">Энэ хугацаанд хөдөлгөөн байхгүй.</p>
            ) : (
              <ul className="space-y-2">
                {data.rows.map((r, i) => (
                  <li key={`${r.ref}-${i}`}>
                    <button type="button" onClick={() => onOpen.openDoc(r.type, r.ref)} className="focus-ring ng-panel flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors hover:border-[rgba(255,213,107,0.5)]">
                      <ToneIcon tone={r.direction === "in" ? "in" : r.tone === "move" ? "move" : "out"} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-text">
                          {r.label} {r.number && <span className="ng-num">№ {r.number}</span>}
                        </span>
                        <span className="block truncate text-xs text-text-muted">
                          <span className="ng-num">{dayOf(r.date)}</span> · {r.warehouse || "Агуулах тодорхойгүй"}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className={cn("ng-num block text-sm", r.direction === "in" ? "text-success" : "text-danger")}>
                          {r.direction === "in" ? "+" : "−"}
                          {qty(r.qty)} {data.unit}
                        </span>
                        <span className="ng-num block text-xs text-text-muted">{money2(r.amount)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
