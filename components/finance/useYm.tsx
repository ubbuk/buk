"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { CalendarDays, ChevronDown } from "lucide-react";
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

const MN_MONTH = (ym: string) => `${ym.slice(0, 4)} оны ${Number(ym.slice(5, 7))}-р сар`;

/** Дээд талын нэгдсэн он, сар сонгогч (бүх табад үйлчилнэ): «2026 оны 11-р сар»; `withView` үед «Сар / Бүтэн жил» сонголт */
export function YmPicker({ withView = false }: { withView?: boolean }) {
  const { ym, current, view, setYm, setView } = useYm();
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <label className="ng-panel focus-within:ring-2 focus-within:ring-[rgba(255,213,107,0.6)] relative flex h-10 cursor-pointer items-center gap-2.5 rounded-xl pl-3.5 pr-3 text-sm text-text">
        <CalendarDays className="size-4 text-[#ffd56b]" />
        <span className="ng-num">{view === "year" ? `${ym.slice(0, 4)} он` : MN_MONTH(ym)}</span>
        <ChevronDown className="size-3.5 text-text-muted" />
        {/* Жинхэнэ нь браузерийн сар сонгогч: харагдахгүйгээр давхарласан */}
        <input
          type="month"
          value={ym}
          max={current}
          onChange={(e) => e.target.value && isMonth(e.target.value) && setYm(e.target.value)}
          onClick={(e) => (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.()}
          aria-label="Он, сар"
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        />
      </label>
      {withView && (
        <div role="group" aria-label="Харагдац" className="ng-panel inline-flex rounded-xl p-1 text-sm">
          {(["month", "year"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={cn("focus-ring h-8 rounded-lg px-3 transition-colors", view === v ? "bg-[rgba(245,181,35,0.16)] text-[#ffd56b] shadow-[0_0_0_1px_rgba(255,213,107,0.5)_inset]" : "text-text-muted hover:text-text")}
            >
              {v === "month" ? "Сар" : "Бүтэн жил"}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
