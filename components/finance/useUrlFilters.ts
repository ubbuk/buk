"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Шүүлтүүдийг URL-д хадгална (сарын ?ym=-тэй хамт, бусад параметр хэвээр): жишээ нь ?q=&keeper=&wh= (Агуулах), ?tab=&q= (Зарцуулалт).
 * `q` нь хайлт: талбар 300 мс-ийн дараа URL-д бичигдэнэ (`qInput` нь талбарын утга). Бусад түлхүүр шууд бичигдэнэ.
 */
export function useUrlFilters<K extends string>(keys: readonly K[]) {
  const sp = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const q = sp.get("q") ?? "";

  // Хугацаатай (debounce) дуудлага хуучирсан searchParams-аар буцаан бичихгүйн тулд үргэлж хамгийн сүүлийн утгыг ашиглана
  const latest = useRef({ sp, q });
  latest.current = { sp, q };

  const set = (patch: Partial<Record<string, string>>) => {
    const next = new URLSearchParams(latest.current.sp.toString());
    for (const [k, v] of Object.entries(patch) as [string, string][]) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    router.replace(`${pathname}?${next}`, { scroll: false });
  };

  const [qInput, setQInput] = useState(q);
  const pushed = useRef(q);
  // URL-аас (буцах товч, цэвэрлэх) ирсэн өөрчлөлтийг талбарт тусгана
  useEffect(() => {
    if (q !== pushed.current) {
      pushed.current = q;
      setQInput(q);
    }
  }, [q]);
  useEffect(() => {
    const value = qInput.trim();
    if (value === q) return;
    const t = setTimeout(() => {
      if (value === latest.current.q) return; // энэ хооронд URL аль хэдийн тэр утгатай болсон (жишээ нь «Шүүлт арилгах»)
      pushed.current = value;
      set({ q: value });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput]);

  const values = Object.fromEntries(keys.map((k) => [k, sp.get(k) ?? ""])) as Record<K, string>;
  return {
    q,
    qInput,
    setQInput,
    values,
    set: (key: K, value: string) => set({ [key]: value }),
    /** Хайлт болон бүх түлхүүрийг арилгана */
    clear: (clearKeys: readonly K[] = keys) => {
      pushed.current = "";
      setQInput("");
      set(Object.fromEntries([["q", ""], ...clearKeys.map((k) => [k, ""])]));
    },
    active: Boolean(q || keys.some((k) => sp.get(k))),
  };
}
