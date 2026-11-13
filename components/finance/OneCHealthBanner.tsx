"use client";

import { AlertOctagon } from "lucide-react";
import { useEffect, useState } from "react";
import { useYm } from "./useYm";

interface Health {
  selected: { year: string; configured: boolean };
  current: { year: string; configured: boolean; unreachable: boolean; lastDocument: string | null; daysSince: number | null; stale: boolean };
  messages: { baseMissing: string; stale: string };
}

/**
 * 1С самбарын бүх табын дээд талын улаан анхааруулга (app/(app)/finance/layout.tsx):
 *  - сонгосон оны 1С бааз тохируулагдаагүй бол «Энэ оны 1С бааз холбогдоогүй»;
 *  - одоогийн оны баазад 7 хоногоос дээш шинэ баримт ороогүй бол «Шинэ оны бааз руу шилжсэн бол ERP-ийн тохиргоог шинэчилнэ үү».
 * Хуудсыг хүлээлгэхгүй, тусад нь ачаална; алдаа гарвал юу ч харуулахгүй (самбарын өөрийнх нь төлөвийг нөлөөлөхгүй).
 */
export function OneCHealthBanner() {
  const { ym } = useYm();
  const [h, setH] = useState<Health | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/dashboard/health?ym=${ym}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => setH(b as Health | null))
      .catch(() => {});
    return () => ctrl.abort();
  }, [ym]);
  if (!h) return null;

  const alerts: string[] = [];
  if (!h.selected.configured) alerts.push(`${h.messages.baseMissing} (${h.selected.year})`);
  if (!h.current.configured && h.current.year !== h.selected.year) alerts.push(`${h.messages.baseMissing} (${h.current.year})`);
  if (h.current.stale) alerts.push(`${h.messages.stale}${h.current.lastDocument ? ` Сүүлийн баримт: ${h.current.lastDocument}.` : ""}`);
  if (alerts.length === 0) return null;

  return (
    <div className="mb-4 space-y-2">
      {alerts.map((m) => (
        <div key={m} role="alert" className="flex items-start gap-3 rounded-xl border border-danger/50 bg-danger/15 px-4 py-3 text-sm text-text shadow-[0_0_24px_-8px_rgba(248,113,113,0.6)]">
          <AlertOctagon className="mt-0.5 size-5 shrink-0 text-danger" />
          <p className="font-medium text-danger">{m}</p>
        </div>
      ))}
    </div>
  );
}
