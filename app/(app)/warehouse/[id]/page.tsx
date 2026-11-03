"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { CheckCircle2, PackageCheck } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { AllocationBar } from "@/components/workflow/AllocationBar";
import { PinModal } from "@/components/workflow/PinModal";
import { useRequestStore } from "@/lib/store";
import { USER_ROLE_LABEL } from "@/lib/types";
import { formatDateTime, formatNumber } from "@/lib/utils";

export default function WarehouseCheckPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { push } = useToast();
  const { data: session } = useSession();
  const requests = useRequestStore((s) => s.requests);
  const warehouseCheck = useRequestStore((s) => s.warehouseCheck);
  const request = requests.find((r) => r.id === params.id);
  const [available, setAvailable] = useState<Record<string, number>>(() =>
    Object.fromEntries((request?.items ?? []).map((i) => [i.id, i.warehouseBalance ?? 0]))
  );
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  if (!request) return null;

  const hasMissing = request.items.some(
    (item) => Math.min(available[item.id] ?? 0, item.requestedQuantity) < item.requestedQuantity
  );

  async function confirmCheck(pin: string) {
    setSubmitting(true);
    setPinError(null);
    try {
      await warehouseCheck(
        request!.id,
        request!.items.map((item) => ({ requestItemId: item.id, availableQuantity: available[item.id] ?? 0 })),
        session?.user?.name ?? "Нярав",
        pin,
        request!.version
      );
      setConfirmed(true);
      setPinOpen(false);
      push({
        kind: "success",
        title: "Агуулахын шалгалт баталгаажлаа",
        description: hasMissing
          ? "Дутуу материал худалдан авалтын баталгаажуулах дараагийн шатанд шилжлээ"
          : "Бүх материал бэлэн байгаа тул захиалга дуусгавар боллоо",
      });
    } catch (err) {
      setPinError(err instanceof Error ? err.message : "Баталгаажуулж чадсангүй");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-text">№{request.requestNumber} — Агуулахын шалгалт</h2>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Тоо хэмжээ баталгаажуулах</CardTitle>
          <span className="text-xs text-text-muted">
            Шалгаж буй: {session?.user?.name ?? "—"} ·{" "}
            <span suppressHydrationWarning>{formatDateTime(new Date())}</span>
          </span>
        </CardHeader>
        <CardBody className="space-y-5">
          {request.items.map((item) => {
            const avail = available[item.id] ?? 0;
            return (
              <div key={item.id} className="rounded-lg border border-border bg-bg-elevated/40 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-text">{item.materialName}</p>
                    <p className="text-xs text-text-muted">
                      Хүссэн тоо: {formatNumber(item.requestedQuantity)} {item.unit}
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-text-muted">
                    Агуулахад буй
                    <input
                      type="number"
                      min={0}
                      step="any"
                      disabled={confirmed}
                      value={avail}
                      onChange={(e) =>
                        setAvailable((prev) => ({ ...prev, [item.id]: Number(e.target.value) || 0 }))
                      }
                      className="focus-ring h-9 w-28 rounded-lg border border-border bg-bg-surface px-2 text-sm text-text disabled:opacity-60"
                    />
                    <span>{item.unit}</span>
                  </label>
                </div>
                <div className="mt-4">
                  <AllocationBar
                    requested={item.requestedQuantity}
                    allocated={Math.min(avail, item.requestedQuantity)}
                    unit={item.unit}
                  />
                </div>
              </div>
            );
          })}
        </CardBody>
      </Card>

      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-bg-surface p-4">
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <PackageCheck className="size-3.5" />
          Байгаа хэмжээ агуулахаас олгогдож, дутуу хэсэг худалдан авалтын батлах хүсэлт болно.
        </div>
        {confirmed ? (
          <Button variant="secondary" onClick={() => router.push("/warehouse")}>
            <CheckCircle2 className="size-4" />
            Баталгаажсан — Жагсаалт руу буцах
          </Button>
        ) : (
          <Button
            onClick={() => {
              setPinError(null);
              setPinOpen(true);
            }}
          >
            <CheckCircle2 className="size-4" />
            Шалгалт баталгаажуулах
          </Button>
        )}
      </div>

      <PinModal
        open={pinOpen}
        onClose={() => setPinOpen(false)}
        onConfirm={confirmCheck}
        approverName={session?.user?.name ?? "—"}
        approverRole={USER_ROLE_LABEL[session?.user?.role ?? ""] ?? "Нярав"}
        processing={submitting}
        error={pinError}
      />
    </div>
  );
}
