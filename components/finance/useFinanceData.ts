"use client";

import { useCallback, useEffect, useState } from "react";

/** /api/dashboard/* -оос өгөгдөл татна; url өөрчлөгдөхөд дахин татаж, хуучин хариуг хаяна. url = null бол татахгүй (өөр харагдац идэвхтэй) */
export function useFinanceData<T>(url: string | null) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });
  // reload(): ар талын шинэчлэл дуусмагц хуудсыг дахин ачаална (хуучин өгөгдөл дэлгэц дээр хэвээр үлдэнэ)
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (url === null) return;
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    fetch(url, { signal: ctrl.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `Алдаа ${res.status}`);
        setState({ data: body as T, error: null, loading: false });
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setState({ data: null, error: e instanceof Error ? e.message : "Өгөгдөл татаж чадсангүй", loading: false });
      });
    return () => ctrl.abort();
  }, [url, tick]);

  return { ...state, reload };
}
