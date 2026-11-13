"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// 1С-ээс шууд (5 минутын cache-тай) татдаг табуудын өгөгдөл: Зарцуулалт. «Шинэчлэх» нь cache-ийг тойрно, гэхдээ сервер
// 60 сек-ээс богино давтамжийг зөвшөөрөхгүй (retryAt-аар товчийг түр идэвхгүй болгоно).
export interface OdataMeta {
  fetchedAt: string;
  cached: boolean;
  stale: boolean;
  retryAfterSeconds: number | null;
}

export function useOdataData<T extends { meta: OdataMeta }>(url: string) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  const load = useCallback(
    (refresh: boolean) => {
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      setState((s) => ({ ...s, loading: true, error: null }));
      fetch(refresh ? `${url}${url.includes("?") ? "&" : "?"}refresh=1` : url, { signal: c.signal })
        .then(async (res) => {
          const body = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(body.error ?? `Алдаа ${res.status}`);
          const data = body as T;
          setRetryAt(data.meta.retryAfterSeconds ? Date.now() + data.meta.retryAfterSeconds * 1000 : null);
          setState({ data, error: null, loading: false });
        })
        .catch((e) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          // Алдаа гарсан ч өмнөх өгөгдөл дэлгэц дээр үлдэнэ
          setState((s) => ({ data: s.data, error: e instanceof Error ? e.message : "Өгөгдөл татаж чадсангүй", loading: false }));
        });
    },
    [url]
  );

  useEffect(() => {
    load(false);
    return () => ctrl.current?.abort();
  }, [load]);

  return { ...state, retryAt, refresh: () => load(true) };
}
