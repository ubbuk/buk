"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import type { DocCard as DocCardData, DocTone } from "@/lib/onec/doc-kinds";
import { cn } from "@/lib/utils";
import { useOdataData, type OdataMeta } from "../useOdataData";
import { useDocDrawer } from "./DocDrawer";
import { OnecError, ToneIcon, toneText } from "./DocParts";
import { dayOf, money2 } from "./format";

const PAGE = 40;
const ALL = "";

interface DocsResponse {
  documents: DocCardData[];
  meta: OdataMeta;
}

/** Баримтын карт: огноо, төрлийн дүрс/өнгө, харилцагч, агуулах, дүн, мөрийн тоо. Дарахад баримтын drawer нээгдэнэ. */
export function DocCard({ doc, tone }: { doc: DocCardData; tone?: DocTone }) {
  const { openDoc } = useDocDrawer();
  const t = tone ?? doc.tone;
  const where = doc.warehouseTo ? `${doc.warehouse} → ${doc.warehouseTo}` : doc.warehouse;
  const meta = [doc.party, where].filter(Boolean).join(" · ");
  return (
    <button type="button" data-testid="doc-card" onClick={() => openDoc(doc.type, doc.ref)} className="focus-ring ng-panel flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors hover:border-[rgba(255,213,107,0.5)] sm:p-3.5">
      <ToneIcon tone={t} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className={cn("text-sm font-medium", toneText(t))}>{doc.label}</span>
          {doc.number && <span className="ng-num text-xs text-text-muted">№ {doc.number}</span>}
          <span className="ng-num text-xs text-text-muted">{dayOf(doc.date)}</span>
        </span>
        <span className="mt-0.5 block truncate text-sm text-text">{meta || "—"}</span>
        {doc.lines != null && doc.lines > 0 && <span className="block text-xs text-text-muted">{doc.lines} мөр</span>}
      </span>
      <span className="ng-num shrink-0 text-right text-sm font-semibold text-text sm:text-base">{money2(doc.amount)}</span>
    </button>
  );
}

export interface DocumentFilters {
  warehouseCode?: string;
  kind?: string;
  q?: string;
}

/**
 * Баримтын жагсаалт: `url` дээрх (1С-ээс шууд, 5 минутын cache) баримтуудыг карт болгож харуулна. Шүүлтүүр: агуулах, төрөл, хайлт.
 * `warehouseCode` өгвөл агуулахын сонголтыг гаднаас удирдана (Агуулах табын шүүлттэй нэгдэнэ).
 * `money`: мөнгөний өнцөг (Борлуулалт = орлого, ногоон); анхдагч нь агуулахын өнцөг (борлуулалт = зарлага, улаан).
 */
export function DocumentList({
  url,
  title,
  icon,
  warehouseCode,
  initialKind,
  initialQuery,
  money = false,
  emptyDescription = "Энэ хугацаанд баримт олдсонгүй.",
  hideWarehouseFilter = false,
}: {
  url: string;
  title: string;
  icon?: React.ReactNode;
  warehouseCode?: string;
  initialKind?: string;
  initialQuery?: string;
  money?: boolean;
  emptyDescription?: string;
  hideWarehouseFilter?: boolean;
}) {
  const { data, error, loading, refresh } = useOdataData<DocsResponse>(url);
  const [warehouse, setWarehouse] = useState(ALL);
  const [kind, setKind] = useState(initialKind ?? ALL);
  const [q, setQ] = useState(initialQuery ?? ALL);
  const [shown, setShown] = useState(PAGE);
  const wh = warehouseCode ?? warehouse;

  const docs = useMemo(() => data?.documents ?? [], [data]);
  const warehouses = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of docs) {
      if (d.warehouseCode) m.set(d.warehouseCode, d.warehouse);
      if (d.warehouseToCode) m.set(d.warehouseToCode, d.warehouseTo);
    }
    return [...m].sort((a, b) => a[1].localeCompare(b[1], "mn"));
  }, [docs]);
  const kinds = useMemo(() => [...new Set(docs.map((d) => d.type))].map((type) => ({ type, label: docs.find((d) => d.type === type)?.label ?? type })), [docs]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return docs.filter(
      (d) =>
        (!wh || d.warehouseCode === wh || d.warehouseToCode === wh) &&
        (!kind || d.type === kind) &&
        (!needle || `${d.number} ${d.party} ${d.warehouse} ${d.warehouseTo} ${d.label}`.toLowerCase().includes(needle))
    );
  }, [docs, wh, kind, q]);
  const total = filtered.reduce((s, d) => s + d.amount, 0);
  const selectClass = "focus-ring ng-panel h-9 max-w-full rounded-lg bg-transparent px-2.5 text-sm text-text";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
        {data && (
          <span className="ng-num text-xs text-text-muted">
            {filtered.length} баримт · {money2(total)}
          </span>
        )}
      </CardHeader>
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="ng-panel relative flex h-9 min-w-0 flex-1 basis-48 items-center gap-2 rounded-lg px-2.5 text-sm text-text">
            <Search className="size-4 shrink-0 text-text-muted" aria-hidden />
            <input
              type="search"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setShown(PAGE);
              }}
              placeholder="Дугаар, харилцагч, агуулах хайх..."
              aria-label="Баримт хайх"
              className="focus-ring h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-text-muted"
            />
          </label>
          {kinds.length > 1 && (
            <select value={kind} onChange={(e) => { setKind(e.target.value); setShown(PAGE); }} aria-label="Баримтын төрөл" className={selectClass}>
              <option value={ALL}>Бүх төрөл</option>
              {kinds.map((k) => (
                <option key={k.type} value={k.type}>
                  {k.label}
                </option>
              ))}
            </select>
          )}
          {!hideWarehouseFilter && warehouseCode === undefined && warehouses.length > 1 && (
            <select value={warehouse} onChange={(e) => { setWarehouse(e.target.value); setShown(PAGE); }} aria-label="Агуулах" className={selectClass}>
              <option value={ALL}>Бүх агуулах</option>
              {warehouses.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          )}
        </div>

        {error && <OnecError message={error} onRetry={refresh} />}
        {data?.meta.stale && <p className="text-xs text-warning">Холбогдохгүй байгаа тул сүүлд татсан мэдээллийг харуулж байна.</p>}

        {loading && !data ? (
          <div className="space-y-2" aria-busy="true">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[68px] rounded-xl" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          !error && <EmptyState title="Баримт олдсонгүй" description={emptyDescription} />
        ) : (
          <>
            <ul className="space-y-2">
              {filtered.slice(0, shown).map((d) => (
                <li key={`${d.type}:${d.ref}`}>
                  <DocCard doc={d} tone={money && d.kind === "sale" ? "in" : undefined} />
                </li>
              ))}
            </ul>
            {filtered.length > shown && (
              <button type="button" onClick={() => setShown((n) => n + PAGE)} className="focus-ring ng-panel mx-auto flex h-9 items-center rounded-lg px-4 text-sm text-text-muted hover:text-text">
                Цааш харуулах ({filtered.length - shown})
              </button>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
