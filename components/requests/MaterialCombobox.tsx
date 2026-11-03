"use client";

import { Check, ChevronDown, PenLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn, formatNumber } from "@/lib/utils";
import type { MaterialCatalogEntry } from "@/lib/types";

export function MaterialCombobox({
  value,
  materials,
  onSelect,
  onManualChange,
}: {
  value: string;
  materials: MaterialCatalogEntry[];
  onSelect: (material: MaterialCatalogEntry) => void;
  onManualChange: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => setQuery(value), [value]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const filtered = materials.filter(
    (m) =>
      m.name.toLowerCase().includes(query.toLowerCase()) ||
      m.code.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            onManualChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Материал хайх эсвэл шинээр бичих..."
          className="focus-ring h-11 w-full rounded-lg border border-border bg-bg-elevated px-3 pr-9 text-base text-text placeholder:text-text-muted"
        />
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
      </div>

      {open && (
        <div className="absolute z-20 mt-1 max-h-72 w-full min-w-[360px] overflow-y-auto rounded-lg border border-border bg-bg-elevated shadow-elevated">
          {filtered.length === 0 ? (
            <div className="flex items-center gap-2 px-3 py-3 text-sm text-text-muted">
              <PenLine className="size-4" />
              Каталогт байхгүй — &quot;{query}&quot; гэж шинээр нэмэгдэнэ
            </div>
          ) : (
            filtered.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  onSelect(m);
                  setQuery(m.name);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-base hover:bg-bg-surface",
                  m.name === value && "bg-bg-surface"
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate text-text">{m.name}</span>
                  <span className="block text-[11px] text-text-muted">{m.code}</span>
                </span>
                <span className="shrink-0 text-right text-[11px] text-text-muted">
                  {formatNumber(m.warehouseBalance)} {m.unit}
                </span>
                {m.name === value && <Check className="size-3.5 shrink-0 text-accent" />}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
