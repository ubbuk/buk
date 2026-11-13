"use client";

import { ChevronLeft, ChevronRight, Database, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";
import { fieldLabel, isTechnicalObject, objectLabel } from "@/lib/onec-odata/labels-mn";
import { KIND_LABEL, formatCell, lastMonthRange, shortObjectName } from "./format";
import { groupObjects, type ObjectItem } from "./grouping";

interface Column {
  key: string;
  type: string;
  ref?: boolean;
}
interface ObjectPage {
  object: string;
  kind: string;
  columns: Column[];
  rows: Record<string, unknown>[];
  page: number;
  pageSize: number;
  hasMore: boolean;
  dateField: string | null;
  filters: { dateFrom: string | null; dateTo: string | null; code: string | null; q: string | null };
  expandSkipped: boolean;
  cached: boolean;
}
interface Filters {
  dateFrom: string;
  dateTo: string;
  code: string;
  q: string;
}

const inputClass = "focus-ring h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-text placeholder:text-text-muted";
const MAX_LISTED = 300;
const EMPTY_FILTERS: Filters = { dateFrom: "", dateTo: "", code: "", q: "" };

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Алдаа ${res.status}`);
  return body as T;
}

export function OnecBrowser() {
  const [objects, setObjects] = useState<ObjectItem[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ObjectItem | null>(null);
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [data, setData] = useState<ObjectPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    getJson<{ objects: ObjectItem[] }>("/api/onec-odata/objects", ctrl.signal)
      .then((r) => setObjects(r.objects))
      .catch((e) => {
        if (!(e instanceof DOMException && e.name === "AbortError")) setListError(e instanceof Error ? e.message : "Жагсаалт татаж чадсангүй");
      });
    return () => ctrl.abort();
  }, []);

  // Объект/шүүлтүүр/хуудас өөрчлөгдөхөд дахин татна; хуучин хариуг хаяна
  useEffect(() => {
    if (!selected) return;
    const ctrl = new AbortController();
    const sp = new URLSearchParams({ object: selected.name, page: String(page), pageSize: String(pageSize) });
    if (applied.dateFrom) sp.set("dateFrom", applied.dateFrom);
    if (applied.dateTo) sp.set("dateTo", applied.dateTo);
    if (applied.code) sp.set("code", applied.code);
    if (applied.q) sp.set("q", applied.q);
    setLoading(true);
    setError(null);
    getJson<ObjectPage>(`/api/onec-odata/data?${sp}`, ctrl.signal)
      .then((r) => {
        setData(r);
        setLoading(false);
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setData(null);
        setError(e instanceof Error ? e.message : "Өгөгдөл татаж чадсангүй");
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [selected, applied, page, pageSize]);

  const choose = useCallback((o: ObjectItem) => {
    // Баримт, регистрт анхдагчаар сүүлийн 1 сар (сервер ч мөн адил хэрэглэнэ)
    const f: Filters = o.kind === "document" || o.kind === "register" ? { ...EMPTY_FILTERS, ...rangeOf() } : EMPTY_FILTERS;
    setSelected(o);
    setDraft(f);
    setApplied(f);
    setPage(1);
    setData(null);
  }, []);

  const groups = useMemo(() => groupObjects(objects ?? [], search), [objects, search]);

  const apply = () => {
    setApplied(draft);
    setPage(1);
  };

  return (
    <div className="mx-auto grid max-w-[1600px] gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <Card className="h-fit lg:sticky lg:top-4">
        <div className="space-y-3 p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Объект хайх…"
              aria-label="Объект хайх"
              className={cn(inputClass, "w-full pl-9")}
            />
          </div>
          <div className="max-h-[70dvh] space-y-1 overflow-y-auto pr-1">
            {listError && <p role="alert" className="text-sm text-danger">{listError}</p>}
            {!objects && !listError && <Skeleton className="h-40 w-full" />}
            {objects && groups.length === 0 && <p className="px-2 py-4 text-sm text-text-muted">Объект олдсонгүй</p>}
            {groups.map((g) => (
              <details key={g.kind} open={!!search.trim() || g.items.some((o) => o.name === selected?.name) || g.kind === "catalog"}>
                <summary className="cursor-pointer select-none rounded-md px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted hover:text-text">
                  {KIND_LABEL[g.kind]} ({g.items.length})
                </summary>
                <ul className="mt-1 space-y-0.5">
                  {g.items.slice(0, MAX_LISTED).map((o) => {
                    const label = objectLabel(o.name);
                    return (
                    <li key={o.name}>
                      <button
                        type="button"
                        title={o.name}
                        onClick={() => choose(o)}
                        className={cn(
                          "focus-ring w-full truncate rounded-md px-2 py-1.5 text-left text-sm max-md:min-h-11",
                          selected?.name === o.name ? "bg-accent/15 font-medium text-text" : "text-text-muted hover:bg-bg-elevated hover:text-text"
                        )}
                      >
                        <span className="block truncate">{label ?? shortObjectName(o.name)}</span>
                        {label && <span className="block truncate text-[11px] font-normal text-text-muted">{o.name}</span>}
                      </button>
                    </li>
                    );
                  })}
                  {g.items.length > MAX_LISTED && <li className="px-2 py-1 text-xs text-text-muted">…бусад {g.items.length - MAX_LISTED}. Хайлтаа нарийсгана уу</li>}
                </ul>
              </details>
            ))}
          </div>
        </div>
      </Card>

      <div className="min-w-0 space-y-4">
        {!selected ? (
          <Card>
            <EmptyState icon={Database} title="1С хөтөч (зөвхөн унших)" description="Зүүн талаас лавлах, баримт, регистрээ сонгоно уу. Энд юу ч өөрчлөгдөхгүй." />
          </Card>
        ) : (
          <>
            <div>
              <h1 className="break-words text-lg font-semibold text-text">{objectLabel(selected.name) ?? shortObjectName(selected.name)}</h1>
              <p className="text-xs text-text-muted">{KIND_LABEL[isTechnicalObject(selected.name) ? "technical" : selected.kind]} · {selected.name}</p>
            </div>

            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                apply();
              }}
            >
              {(data ? data.dateField !== null : selected.kind === "document" || selected.kind === "register") && (
                <>
                  <label className="space-y-1 text-xs text-text-muted">
                    Эхлэх огноо
                    <input type="date" value={draft.dateFrom} onChange={(e) => setDraft({ ...draft, dateFrom: e.target.value })} className={cn(inputClass, "block")} />
                  </label>
                  <label className="space-y-1 text-xs text-text-muted">
                    Дуусах огноо
                    <input type="date" value={draft.dateTo} onChange={(e) => setDraft({ ...draft, dateTo: e.target.value })} className={cn(inputClass, "block")} />
                  </label>
                </>
              )}
              <label className="space-y-1 text-xs text-text-muted">
                Код / дугаар
                <input value={draft.code} maxLength={100} onChange={(e) => setDraft({ ...draft, code: e.target.value })} className={cn(inputClass, "block w-36")} />
              </label>
              <label className="space-y-1 text-xs text-text-muted">
                Нэрээр хайх
                <input value={draft.q} maxLength={100} onChange={(e) => setDraft({ ...draft, q: e.target.value })} className={cn(inputClass, "block w-48")} />
              </label>
              <Button type="submit" disabled={loading}>Хайх</Button>
              <label className="ml-auto space-y-1 text-xs text-text-muted">
                Мөр
                <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className={cn(inputClass, "block")}>
                  {[25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </form>

            {error && <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}
            {data?.expandSkipped && <p className="text-xs text-warning">Холбоосын нэрийг 1С буцаасангүй: зөвхөн үндсэн талбарууд харагдаж байна.</p>}

            <Card>
              {loading && !data ? (
                <div className="space-y-2 p-4"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
              ) : data && data.rows.length === 0 ? (
                <EmptyState title="Өгөгдөл олдсонгүй" description="Шүүлтүүрээ өөрчилж үзнэ үү" />
              ) : data ? (
                <div className={cn("overflow-x-auto", loading && "opacity-60")}>
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-text-muted">
                        {data.columns.map((c) => <ColumnHeader key={c.key} name={c.key} />)}
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((row, i) => (
                        <tr key={i} onClick={() => setDetail(row)} className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-bg-elevated/60">
                          {data.columns.map((c) => (
                            <td key={c.key} className={cn("max-w-[22rem] truncate px-3 py-2 text-text", isNumeric(c.type) && "text-right tabular-nums")}>
                              {formatCell(row[c.key], c.type)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </Card>

            {data && (
              <div className="flex items-center justify-between gap-2 text-xs text-text-muted">
                <span>{data.rows.length} мөр · {data.page}-р хуудас{data.cached ? " · cache (5 минут)" : ""}</span>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" disabled={loading || data.page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="size-4" />Өмнөх</Button>
                  <Button variant="secondary" size="sm" disabled={loading || !data.hasMore} onClick={() => setPage((p) => p + 1)}>Дараах<ChevronRight className="size-4" /></Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <Modal open={!!detail} onClose={() => setDetail(null)} title="Дэлгэрэнгүй" description={selected?.name} className="max-w-2xl">
        {detail && data && (
          <dl className="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
            {Object.entries(detail).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="break-words text-text-muted">
                  {fieldLabel(k) ?? k}
                  {fieldLabel(k) && <span className="block text-[11px] text-text-muted/70">{k}</span>}
                </dt>
                <dd className="break-words text-text">{formatCell(v, data.columns.find((c) => c.key === k)?.type ?? "")}</dd>
              </div>
            ))}
          </dl>
        )}
      </Modal>
    </div>
  );
}

/** Монгол нэр дээр, 1С-ийн жинхэнэ нэр доор нь жижиг саарал үсгээр; орчуулгагүй бол зөвхөн жинхэнэ нэр */
function ColumnHeader({ name }: { name: string }) {
  const label = fieldLabel(name);
  return (
    <th title={name} className="whitespace-nowrap px-3 py-2.5 font-medium">
      {label ?? name}
      {label && <span className="block text-[11px] font-normal text-text-muted/70">{name}</span>}
    </th>
  );
}

const isNumeric = (t: string) => t.startsWith("Edm.") && /Double|Decimal|Int|Single/.test(t);

function rangeOf() {
  const r = lastMonthRange();
  return { dateFrom: r.from, dateTo: r.to };
}
