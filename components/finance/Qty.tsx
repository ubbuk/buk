"use client";

import { useState } from "react";
import { formatQuantities, formatQuantity, type Quantity } from "@/lib/units";
import { cn } from "@/lib/utils";

/** Тоо хэмжээ нэгжтэйгээ: «30 тонн», кг ≥ 1000 бол тонн; дарахад бүтэн тоо («30,250 кг»). Мөр доторх товч дотор байж болно (span[role=button]). */
function Toggle({ short, full, className }: { short: string; full: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const flip = () => setOpen((o) => !o);
  return (
    <span
      role="button"
      tabIndex={0}
      title={open ? "Товчлох" : full}
      aria-label={open ? full : `${full} (бүтэн тоог харуулах)`}
      onClick={(e) => {
        e.stopPropagation();
        flip();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          flip();
        }
      }}
      className={cn("ng-num cursor-pointer whitespace-nowrap rounded px-0.5 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[rgba(255,213,107,0.6)]", className)}
    >
      {open ? full : short}
    </span>
  );
}

export function Qty({ qty, unit, className }: { qty: number; unit: string; className?: string }) {
  const f = formatQuantity(qty, unit);
  return <Toggle short={f.short} full={f.full} className={className} />;
}

/** Бүлгийн нийлбэр: «48.5 тонн · 3,200 ширхэг» (нэгж бүр тусдаа) */
export function QtySum({ quantities, className }: { quantities: readonly Quantity[]; className?: string }) {
  const f = formatQuantities(quantities);
  return <Toggle short={f.short} full={f.full} className={className} />;
}
