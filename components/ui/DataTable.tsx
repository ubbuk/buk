"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useMediaQuery } from "@/lib/use-media-query";
import { EmptyState } from "./EmptyState";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  headerIcon?: React.ReactNode;
  sortable?: boolean;
  accessor: (row: T) => string | number | null;
  render: (row: T) => React.ReactNode;
  className?: string;
}

export function DataTable<T>({
  data,
  columns,
  searchPlaceholder = "Хайх...",
  getRowId,
  onRowClick,
  emptyTitle = "Өгөгдөл олдсонгүй",
  emptyDescription,
}: {
  data: T[];
  columns: DataTableColumn<T>[];
  searchPlaceholder?: string;
  getRowId: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  // Phones get one card per row (same rows, sorting, search and click handler as the table).
  const isPhone = useMediaQuery("(max-width: 767px)");

  const filtered = useMemo(() => {
    let rows = data;
    if (query.trim()) {
      const q = query.toLowerCase();
      rows = rows.filter((row) =>
        columns.some((col) => String(col.accessor(row) ?? "").toLowerCase().includes(q))
      );
    }
    if (sortKey) {
      const col = columns.find((c) => c.key === sortKey);
      if (col) {
        rows = [...rows].sort((a, b) => {
          const av = col.accessor(a);
          const bv = col.accessor(b);
          // Unknown values (e.g. a request with no price yet) sort last
          // regardless of direction, rather than comparing against "null".
          if (av === null && bv === null) return 0;
          if (av === null) return 1;
          if (bv === null) return -1;
          const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
          return sortDir === "asc" ? cmp : -cmp;
        });
      }
    }
    return rows;
  }, [data, query, sortKey, sortDir, columns]);

  function toggleSort(key: string) {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
    } else {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3 sm:px-5">
        <div className="relative w-full max-w-xs max-sm:min-w-0 max-sm:flex-1 max-sm:basis-40">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="focus-ring h-8 w-full rounded-lg border border-border bg-bg-elevated pl-8 pr-3 text-xs text-text placeholder:text-text-muted"
          />
        </div>
        <span className="ml-auto whitespace-nowrap text-xs text-text-muted">{filtered.length} мөр</span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : isPhone ? (
        <>
          {columns.some((c) => c.sortable) && (
            <div className="flex items-center gap-2 border-b border-border px-4 py-2">
              <label className="text-xs text-text-muted" htmlFor="datatable-sort">
                Эрэмбэлэх
              </label>
              <select
                id="datatable-sort"
                value={sortKey ?? ""}
                onChange={(e) => {
                  setSortKey(e.target.value || null);
                  setSortDir("asc");
                }}
                className="focus-ring h-11 min-w-0 flex-1 rounded-lg border border-border bg-bg-elevated px-2 text-text"
              >
                <option value="">—</option>
                {columns
                  .filter((c) => c.sortable)
                  .map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.header}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                disabled={!sortKey}
                onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                aria-label={sortDir === "asc" ? "Өсөхөөр" : "Буурахаар"}
                className="focus-ring flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-bg-elevated text-text-muted disabled:opacity-40"
              >
                {sortDir === "asc" ? <ArrowUp className="size-4" /> : <ArrowDown className="size-4" />}
              </button>
            </div>
          )}
          <ul className="space-y-3 p-3">
            {filtered.map((row) => {
              const [titleCol, ...rest] = columns;
              const fields = rest.filter((c) => c.header);
              const actions = rest.filter((c) => !c.header);
              return (
                <li
                  key={getRowId(row)}
                  onClick={() => onRowClick?.(row)}
                  onKeyDown={(e) => {
                    if (onRowClick && e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      onRowClick(row);
                    }
                  }}
                  tabIndex={onRowClick ? 0 : undefined}
                  role={onRowClick ? "button" : undefined}
                  className={`min-w-0 space-y-2.5 rounded-lg border border-border bg-bg-elevated/40 p-3 ${
                    onRowClick ? "focus-ring cursor-pointer active:bg-bg-elevated/70" : ""
                  }`}
                >
                  {titleCol && <div className="min-w-0 break-words text-sm font-medium text-text">{titleCol.render(row)}</div>}
                  {fields.length > 0 && (
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
                      {fields.map((col) => (
                        <div key={col.key} className="min-w-0">
                          <dt className="flex items-center gap-1 text-[11px] text-text-muted">
                            {col.headerIcon}
                            {col.header}
                          </dt>
                          <dd className="min-w-0 break-words text-sm text-text">{col.render(row)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {actions.length > 0 && (
                    <div className="flex flex-wrap justify-end gap-2">
                      {actions.map((col) => (
                        <div key={col.key}>{col.render(row)}</div>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-text-muted">
                {columns.map((col) => (
                  <th key={col.key} className={`px-5 py-2.5 font-medium ${col.className ?? ""}`}>
                    {col.sortable ? (
                      <button
                        onClick={() => toggleSort(col.key)}
                        className="focus-ring flex items-center gap-1 hover:text-text"
                      >
                        {col.headerIcon}
                        {col.header}
                        {sortKey === col.key ? (
                          sortDir === "asc" ? (
                            <ArrowUp className="size-3" />
                          ) : (
                            <ArrowDown className="size-3" />
                          )
                        ) : (
                          <ArrowUpDown className="size-3 opacity-40" />
                        )}
                      </button>
                    ) : (
                      <span className="flex items-center gap-1">
                        {col.headerIcon}
                        {col.header}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr
                  key={getRowId(row)}
                  onClick={() => onRowClick?.(row)}
                  className={`border-b border-border/60 last:border-0 ${
                    onRowClick ? "cursor-pointer hover:bg-bg-elevated/50" : ""
                  }`}
                >
                  {columns.map((col) => (
                    <td key={col.key} className={`px-5 py-3 ${col.className ?? ""}`}>
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
