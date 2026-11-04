"use client";

import { Check, ChevronDown, PenLine } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn, formatNumber } from "@/lib/utils";
import type { MaterialCatalogEntry } from "@/lib/types";

// The list is portaled to <body> (position: fixed) so the table's horizontal
// scroll container and the HUD panels' clip-path never cut it off. The portal
// root carries `hud-form` so it keeps the page's palette.
export function MaterialCombobox({
  value,
  materials,
  onSelect,
  onManualChange,
  invalid,
}: {
  value: string;
  materials: MaterialCatalogEntry[];
  onSelect: (material: MaterialCatalogEntry) => void;
  onManualChange: (name: string) => void;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [active, setActive] = useState(-1);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => setQuery(value), [value]);

  const place = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ left: r.left, top: r.bottom + 4, width: Math.max(r.width, 360) });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (containerRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const filtered = materials.filter(
    (m) =>
      m.name.toLowerCase().includes(query.toLowerCase()) ||
      m.code.toLowerCase().includes(query.toLowerCase())
  );

  function choose(m: MaterialCatalogEntry) {
    onSelect(m);
    setQuery(m.name);
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && open && active >= 0 && filtered[active]) {
      e.preventDefault();
      choose(filtered[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  useEffect(() => {
    if (active < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-invalid={invalid || undefined}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            onManualChange(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Материал хайх эсвэл шинээр бичих..."
          className="hud-input pr-9"
        />
        <ChevronDown
          className={cn(
            "pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-text-muted transition-transform",
            open && "rotate-180 text-accent"
          )}
        />
      </div>

      {open &&
        rect &&
        createPortal(
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            className="hud-form hud-pop fixed z-50 max-h-72 overflow-y-auto rounded-lg border border-tech/40 !bg-[rgb(9,26,38)] shadow-[0_12px_32px_rgba(0,0,0,0.6),0_0_18px_rgba(54,201,244,0.12)]"
            style={{ left: rect.left, top: rect.top, width: rect.width, backgroundImage: "none" }}
          >
            {filtered.length === 0 ? (
              <div className="flex items-center gap-2 px-3 py-3 text-sm text-text-muted">
                <PenLine className="size-4" />
                Каталогт байхгүй — &quot;{query}&quot; гэж шинээр нэмэгдэнэ
              </div>
            ) : (
              filtered.map((m, i) => (
                <button
                  key={m.id}
                  type="button"
                  role="option"
                  aria-selected={m.name === value}
                  data-index={i}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(m)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-base text-text hover:bg-tech/10",
                    (m.name === value || i === active) && "bg-tech/10"
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{m.name}</span>
                    <span className="block text-[11px] text-text-muted">{m.code}</span>
                  </span>
                  <span className="shrink-0 text-right text-[11px] text-text-muted">
                    {formatNumber(m.warehouseBalance)} {m.unit}
                  </span>
                  {m.name === value && <Check className="size-3.5 shrink-0 text-accent" />}
                </button>
              ))
            )}
          </div>,
          document.body
        )}
    </div>
  );
}
