"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { formatNumber } from "@/lib/utils";
import type { MaterialRequestItemView } from "@/lib/types";

export function ResubmitShortfallModal({
  open,
  onClose,
  items,
  onSubmit,
  processing,
}: {
  open: boolean;
  onClose: () => void;
  items: MaterialRequestItemView[];
  onSubmit: (adjustments: { requestItemId: string; quantity: number }[]) => void;
  processing: boolean;
}) {
  const openItems = items.filter((i) => (i.missingQuantity ?? 0) > 0);
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  useEffect(() => {
    if (open) {
      setQuantities(Object.fromEntries(openItems.map((i) => [i.id, i.missingQuantity ?? 0])));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function submit() {
    onSubmit(openItems.map((i) => ({ requestItemId: i.id, quantity: Math.max(0, quantities[i.id] ?? 0) })));
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Дутуу материалын хүсэлтийг засах"
      description="Хэрэгтэй тоог өөрчлөх, эсвэл шаардлагагүй болсныг цуцлах боломжтой"
      className="max-w-lg"
    >
      <div className="space-y-4">
        {openItems.map((item) => (
          <div key={item.id} className="rounded-lg border border-border bg-bg-elevated/40 p-3">
            <p className="text-sm font-medium text-text">{item.materialName}</p>
            <div className="mt-2 flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-text-muted">
                Хэрэгтэй тоо
                <input
                  type="number"
                  min={0}
                  max={item.missingQuantity ?? 0}
                  step="any"
                  value={quantities[item.id] ?? 0}
                  onChange={(e) => setQuantities((prev) => ({ ...prev, [item.id]: Number(e.target.value) || 0 }))}
                  className="focus-ring h-9 w-28 rounded-lg border border-border bg-bg-surface px-2 text-sm text-text"
                />
                <span>{item.unit}</span>
              </label>
              <button
                type="button"
                onClick={() => setQuantities((prev) => ({ ...prev, [item.id]: 0 }))}
                className="focus-ring rounded-lg border border-border px-2.5 py-1.5 text-xs text-text-muted hover:border-danger/40 hover:text-danger"
              >
                Хэрэггүй — цуцлах
              </button>
            </div>
            {(quantities[item.id] ?? 0) === 0 && (
              <p className="mt-1.5 text-[11px] text-text-muted">
                Энэ мөрийг цуцална: өмнө нь олгосон {formatNumber(item.allocatedQuantity ?? 0)} {item.unit}-р хязгаарлагдана
              </p>
            )}
          </div>
        ))}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={processing}>
            Болих
          </Button>
          <Button onClick={submit} loading={processing}>
            Дахин илгээх
          </Button>
        </div>
      </div>
    </Modal>
  );
}
