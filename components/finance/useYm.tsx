"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCallback } from "react";
import { isMonth } from "@/lib/onec/dates";
import { currentMonthUb } from "./useOnecRefresh";
import { cn } from "@/lib/utils";

// Бүх табад нэг сар сонгогч: URL-ийн ?ym=2026-11 (болон Борлуулалт, Зардал-ын ?view=year) дээр хадгалагдана. Таб солиход хадгалагдана.
// Анхдагч нь одоогийн сар; буруу эсвэл ирээдүйн сар бол одоогийн сар.
export type YmView = "month" | "year";

export function useYm() {
  const sp = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const current = currentMonthUb();
  const raw = sp.get("ym");
  const ym = isMonth(raw) && raw <= current ? raw : current;
  const view: YmView = sp.get("view") === "year" ? "year" : "month";

  const update = useCallback(
    (patch: { ym?: string; view?: YmView }) => {
      const next = new URLSearchParams(sp.toString());
      if (patch.ym) next.set("ym", patch.ym);
      if (patch.view) {
        if (patch.view === "year") next.set("view", "year");
        else next.delete("view");
      }
      router.replace(`${pathname}?${next}`, { scroll: false });
    },
    [sp, pathname, router]
  );

  return { ym, current, isCurrent: ym === current, view, year: Number(ym.slice(0, 4)), setYm: (v: string) => update({ ym: v }), setView: (v: YmView) => update({ view: v }) };
}

export function useIsAdmin(): boolean {
  return useSession().data?.user?.role === "ADMIN";
}

const inputClass = "focus-ring h-9 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-text";

/** Дээд талын нэгдсэн он, сар сонгогч (бүх табад үйлчилнэ); `withView` үед «Сар / Бүтэн жил» сонголт */
export function YmPicker({ withView = false }: { withView?: boolean }) {
  const { ym, current, view, setYm, setView } = useYm();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="month"
        value={ym}
        max={current}
        onChange={(e) => e.target.value && isMonth(e.target.value) && setYm(e.target.value)}
        aria-label="Он, сар"
        className={inputClass}
      />
      {withView && (
        <div role="group" aria-label="Харагдац" className="inline-flex rounded-lg border border-border bg-bg-elevated p-0.5 text-sm">
          {(["month", "year"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={cn("focus-ring h-8 rounded-md px-3 transition-colors", view === v ? "bg-accent text-bg" : "text-text-muted hover:text-text")}
            >
              {v === "month" ? "Сар" : "Бүтэн жил"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
