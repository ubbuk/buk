"use client";

import { useEffect, useState } from "react";
import { PackageX } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { AttachmentsPanel } from "@/components/workflow/AttachmentsPanel";
import { formatNumber, formatPriceOrPending } from "@/lib/utils";
import type { AttachmentView, MaterialRequestItemView } from "@/lib/types";

interface CatalogExtra {
  category: string | null;
  isActive: boolean;
  balancesByWarehouse: { warehouseId: string; warehouseName: string; quantityOnHand: number; quantityReserved: number }[];
}

export function MaterialDetailModal({
  item,
  requestId,
  attachments,
  onClose,
  canMarkUnavailable,
  onMarkUnavailable,
}: {
  item: MaterialRequestItemView | null;
  requestId: string;
  attachments: AttachmentView[];
  onClose: () => void;
  canMarkUnavailable: boolean;
  onMarkUnavailable: (itemId: string) => void;
}) {
  const [catalog, setCatalog] = useState<CatalogExtra | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!item?.materialId) {
      setCatalog(null);
      return;
    }
    setLoading(true);
    setError(null);
    fetch(`/api/materials/${item.materialId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Материал олдсонгүй");
        return res.json();
      })
      .then((data) => setCatalog({ category: data.category, isActive: data.isActive, balancesByWarehouse: data.balancesByWarehouse }))
      .catch((err) => setError(err instanceof Error ? err.message : "Алдаа гарлаа"))
      .finally(() => setLoading(false));
  }, [item?.materialId]);

  return (
    <Modal open={!!item} onClose={onClose} title={item?.materialName ?? "Материалын дэлгэрэнгүй"}>
      {item && (
        <div className="space-y-3 text-sm">
          <Row label="Нэр" value={item.materialName} />
          <Row label="Хэмжих нэгж" value={item.unit} />
          <Row label="Захиалсан тоо" value={`${formatNumber(item.requestedQuantity)} ${item.unit}`} />
          <Row label="Захиалсан нэгж үнэ" value={formatPriceOrPending(item.unitPrice)} />

          {item.materialId && loading && (
            <div className="space-y-2 border-t border-border pt-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          )}
          {item.materialId && !loading && error && <p className="border-t border-border pt-3 text-danger">{error}</p>}
          {item.materialId && !loading && catalog && (
            <>
              <Row label="Ангилал" value={catalog.category ?? "—"} />
              <Row label="Төлөв" value={catalog.isActive ? "Идэвхтэй" : "Идэвхгүй"} />
              <div className="border-t border-border pt-3">
                <p className="mb-1.5 text-xs font-medium text-text-muted">Агуулахын үлдэгдэл</p>
                {catalog.balancesByWarehouse.length === 0 ? (
                  <p className="text-text-muted">Бүртгэлгүй</p>
                ) : (
                  <ul className="space-y-1">
                    {catalog.balancesByWarehouse.map((b) => (
                      <li key={b.warehouseId} className="flex items-center justify-between">
                        <span className="text-text-muted">{b.warehouseName}</span>
                        <span className="font-medium text-text">
                          {formatNumber(b.quantityOnHand)} {item.unit}
                          {b.quantityReserved > 0 && (
                            <span className="ml-1.5 text-xs text-warning">({formatNumber(b.quantityReserved)} захиалгад)</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}

          <div className="border-t border-border pt-3">
            <p className="mb-1.5 text-xs font-medium text-text-muted">Захиалгад хавсаргасан файл</p>
            <AttachmentsPanel requestId={requestId} attachments={attachments} canUpload={false} />
          </div>

          {canMarkUnavailable && (
            <div className="border-t border-border pt-3">
              <Button variant="danger" size="sm" className="w-full" onClick={() => onMarkUnavailable(item.id)}>
                <PackageX className="size-3.5" />
                Агуулахад байхгүй — цааш шилжүүлэх
              </Button>
              <p className="mt-1.5 text-xs text-text-muted">
                Энэ материалыг 0 хэмжээтэйгээр агуулахын шалгалт болгон баталгаажуулж, дутуу хэсгийг худалдан авалтын шатанд шилжүүлнэ.
              </p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-text-muted">{label}</span>
      <span className="font-medium text-text">{value}</span>
    </div>
  );
}
