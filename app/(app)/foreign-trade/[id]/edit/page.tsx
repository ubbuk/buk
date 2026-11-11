"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { ForeignTradeForm } from "@/components/foreign-trade/ForeignTradeForm";
import { ftApi } from "@/components/foreign-trade/api";
import type { FtOrderView } from "@/lib/foreign-trade";

export default function EditForeignTradePage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<FtOrderView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    ftApi<FtOrderView>(`/api/foreign-trade/${id}`).then((r) => {
      if (cancelled) return;
      if (r.ok) setOrder(r.data);
      else setError(r.error);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) return <EmptyState title="Захиалга олдсонгүй" description={error} />;
  if (!order) return <Skeleton className="mx-auto h-64 max-w-3xl" />;
  if (!order.access.editOrder) return <EmptyState title="Засах боломжгүй" description="Энэ захиалгыг одоогийн шатанд засах боломжгүй" />;
  return <ForeignTradeForm initial={{ id: order.id, version: order.version, purpose: order.purpose ?? "", items: order.items }} />;
}
