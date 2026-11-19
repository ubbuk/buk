"use client";

import { useState } from "react";
import { formatMoneyFull, formatMoneyShort } from "@/lib/money-short";
import { cn } from "@/lib/utils";

/** span[role=button]: мөр, харилцагчийн товч дотор байх тул `<button>` биш (button доторх button нь HTML алдаа). Дүн «84.1 сая₮» хэлбэртэй; дарахад бүтэн тоо (84,073,015.25₮), дахин дарахад буцна. Hover-д бүтэн тоо. */
export function Amount({ value, className, signed = false }: { value: number; className?: string; signed?: boolean }) {
  const [full, setFull] = useState(false);
  const text = full ? formatMoneyFull(value) : formatMoneyShort(value);
  return (
    <span
      role="button"
      tabIndex={0}
      title={full ? "Товчлох" : formatMoneyFull(value)}
      aria-label={`${formatMoneyFull(value)}${full ? "" : " (бүтэн дүнг харуулах)"}`}
      onClick={(e) => {
        e.stopPropagation();
        setFull((f) => !f);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          setFull((f) => !f);
        }
      }}
      className={cn("ng-num cursor-pointer whitespace-nowrap rounded px-0.5 text-inherit hover:bg-white/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[rgba(255,213,107,0.6)]", className)}
    >
      {signed && value > 0 ? "+" : ""}
      {text}
    </span>
  );
}
