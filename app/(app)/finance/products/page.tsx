"use client";

import { Suspense, useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Boxes } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorNote, FinanceShell } from "@/components/finance/FinanceShell";
import { PeriodBar, ProductCardView, ProductDetailView, ProductSearchBox, TopList, periodLabel, type PeriodKey } from "@/components/finance/products/ProductParts";
import { useFinanceData } from "@/components/finance/useFinanceData";
import { isDate, isMonth, monthRange, today as todayUb } from "@/lib/onec/dates";
import { periodRange, type ProductCard, type ProductSearchView } from "@/lib/onec/product-search";

type Data = ProductSearchView & { today: string; stockAsOf: string | null };

/** from/to-оос хугацааны төрөл: бэлэн сонголттой таарвал тэр, нэг бүтэн сар бол «сар», бусад нь «custom» */
function periodKey(from: string, to: string, today: string): PeriodKey {
  const eq = (r: { from: string; to: string }) => r.from === from && r.to === to;
  if (eq(periodRange("this", today))) return "this";
  if (eq(periodRange("last", today))) return "last";
  if (eq(periodRange("year", today))) return "year";
  if (isMonth(from.slice(0, 7)) && eq(monthRange(from.slice(0, 7)))) return "month";
  return "custom";
}

/**
 * «Бүтээгдэхүүн»: нэг бүтээгдэхүүнийг БҮХ цехээр хайна. URL: ?q=1000&from=2026-10-01&to=2026-10-31&p=<бүтээгдэхүүн> (хуваалцаж болно).
 * Хайлтгүй үед хамгийн их үйлдвэрлэсэн, зарсан 10. Карт дарахад өдөр бүр, сүүлийн 12 сар.
 */
function ProductsPage() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const today = useMemo(() => todayUb(), []);
  const def = periodRange("this", today);
  const q = (sp.get("q") ?? "").slice(0, 120);
  const from = isDate(sp.get("from")) ? sp.get("from")! : def.from;
  const to = isDate(sp.get("to")) ? sp.get("to")! : def.to;
  const p = sp.get("p") ?? "";

  const apiUrl = `/api/dashboard/products?${new URLSearchParams({ q, from, to, ...(p ? { p } : {}) }).toString()}`;
  const { data, error } = useFinanceData<Data>(apiUrl);

  const go = useCallback(
    (next: { q?: string; from?: string; to?: string; p?: string | null }) => {
      const n = { q, from, to, p: p || null, ...next };
      const params = new URLSearchParams();
      if (n.q) params.set("q", n.q);
      if (n.from !== def.from || n.to !== def.to) {
        params.set("from", n.from);
        params.set("to", n.to);
      }
      if (n.p) params.set("p", n.p);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [q, from, to, p, def.from, def.to, pathname, router]
  );

  const key = periodKey(from, to, today);
  const label = periodLabel(key, from, to);
  const onSearch = useCallback((text: string) => go({ q: text, p: null }), [go]);
  const pick = (c: ProductCard) => go({ q: c.name, p: c.id });

  return (
    <FinanceShell title="Бүтээгдэхүүн" subtitle="Бүтээгдэхүүнээр хайж, хэдийг хийж, зарж, агуулахад хэд байгааг харна" icon={Boxes} lastSyncedAt={null} hideYm>
      <ProductSearchBox value={q} onSearch={onSearch} autoFocus />
      <PeriodBar active={key} month={key === "month" ? from.slice(0, 7) : to.slice(0, 7)} today={today} onPreset={(k) => go({ ...periodRange(k, today), p: p || null })} onMonth={(ym) => go({ ...monthRange(ym), p: p || null })} />
      {error && <ErrorNote message={error} />}

      {!data ? (
        <div className="space-y-3">
          <Skeleton className="h-36 rounded-xl" />
          <Skeleton className="h-36 rounded-xl" />
        </div>
      ) : data.top ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <TopList title={`${label} хамгийн их үйлдвэрлэсэн 10`} items={data.top.produced} kind="produced" onPick={pick} />
          {data.showSales && <TopList title={`${label} хамгийн их зарсан 10`} items={data.top.sold} kind="sold" onPick={pick} />}
        </div>
      ) : data.products.length === 0 ? (
        <Card>
          <p className="px-5 py-10 text-center text-sm text-text-muted">«{q}» гэсэн бүтээгдэхүүн {label.toLowerCase()} олдсонгүй</p>
        </Card>
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-3">
            {data.products.map((c) => (
              <ProductCardView key={c.id} card={c} period={label} open={data.detail?.id === c.id} onToggle={() => go({ p: data.detail?.id === c.id ? null : c.id })}>
                {data.detail?.id === c.id && <ProductDetailView detail={data.detail} from={from} to={to} today={data.today} showSales={data.showSales} onMonth={(ym) => go({ ...monthRange(ym), p: c.id })} />}
              </ProductCardView>
            ))}
          </ul>
          {data.truncated && <p className="text-center text-xs text-text-muted">Хамгийн их тоотой {data.products.length}-ийг харууллаа. Хайлтаа нарийсгана уу</p>}
        </>
      )}
    </FinanceShell>
  );
}

// useSearchParams: Suspense-ээр боож, хуудас бүтнээрээ статик болохоос сэргийлнэ
export default function Page() {
  return (
    <Suspense fallback={null}>
      <ProductsPage />
    </Suspense>
  );
}
