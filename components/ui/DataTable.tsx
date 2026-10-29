"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState } from "./EmptyState";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  sortable?: boolean;
  accessor: (row: T) => string | number;
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

  const filtered = useMemo(() => {
    let rows = data;
    if (query.trim()) {
      const q = query.toLowerCase();
      rows = rows.filter((row) =>
        columns.some((col) => String(col.accessor(row)).toLowerCase().includes(q))
      );
    }
    if (sortKey) {
      const col = columns.find((c) => c.key === sortKey);
      if (col) {
        rows = [...rows].sort((a, b) => {
          const av = col.accessor(a);
          const bv = col.accessor(b);
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
      <div className="flex items-center gap-3 border-b border-border px-5 py-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="focus-ring h-8 w-full rounded-lg border border-border bg-bg-elevated pl-8 pr-3 text-xs text-text placeholder:text-text-muted"
          />
        </div>
        <span className="ml-auto text-xs text-text-muted">{filtered.length} мөр</span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
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
                      col.header
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
