"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";

interface Freshness {
  stale: boolean;
  message: string | null;
  lastSyncedLabel: string | null;
}

const RECHECK_MS = 5 * 60_000;

/**
 * 1С самбарын бүх табын дээд талын шар анхааруулга (app/(app)/finance/layout.tsx): хуваарьт цагт сүүлийн амжилттай агуулахын sync 90 минутаас
 * хуучин бол (дүрэм lib/onec/sync-schedule.ts). Дүгнэлтийг сервер гаргана: хөтчийн цаг буруу байсан ч нөлөөлөхгүй.
 * Хуудсыг хүлээлгэхгүй; алдаа гарвал юу ч харуулахгүй (OneCHealthBanner-тай адил).
 */
export function StaleDataBanner() {
  const [f, setF] = useState<Freshness | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    const load = () =>
      fetch("/api/dashboard/stock-freshness", { signal: ctrl.signal, cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((b) => setF(b as Freshness | null))
        .catch(() => {});
    load();
    const t = setInterval(load, RECHECK_MS);
    return () => {
      ctrl.abort();
      clearInterval(t);
    };
  }, []);
  if (!f?.stale || !f.message) return null;

  return (
    <div role="status" data-testid="stale-data-banner" className="mb-4 flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-text">
      <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" />
      <div>
        <p className="font-medium text-warning">{f.message}</p>
        <p className="mt-0.5 text-xs text-text-muted">Сүүлд шинэчилсэн: {f.lastSyncedLabel ? `${f.lastSyncedLabel} (Улаанбаатарын цаг)` : "—"}</p>
      </div>
    </div>
  );
}
