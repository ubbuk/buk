"use client";

import { useState } from "react";
import type { ProcurementDetail } from "@/lib/monitoring/procurement-types";
import { ACTION_LABEL, formatDuration, formatUB } from "./format";
import { cn, formatCurrency } from "@/lib/utils";
import { Modal } from "@/components/ui/Modal";
import { DataGrid, Td, Th } from "./Panel";
import { ItemsTable } from "./ProcurementItemsTable";
import { KIND_LABEL, KIND_TONE, qty, STAGE_LABEL, STAGE_TONE } from "./procurement-ui";
import { useLiveData } from "./useLiveData";

const API = "/api/admin/monitoring";

const PROCUREMENT_ACTION_LABEL: Record<string, string> = {
  ...ACTION_LABEL,
  PROCUREMENT_PURCHASE: "Худалдан авалт бүртгэсэн",
  PROCUREMENT_VOID: "Бичлэг хүчингүй болгосон",
  PROCUREMENT_CLASSIFY: "Ангилал баталгаажуулсан",
  PROCUREMENT_REASSIGN: "Хариуцагч шилжүүлсэн",
  PROCUREMENT_COMPLETE: "Худалдан авалт дуусгасан",
};

/**
 * Read-only inspection of one request: stage, domestic / international groups,
 * material progress, purchases (voided ones struck through, never hidden), audit
 * timeline and handover history. There is deliberately no action button here.
 */
export function ProcurementDetailModal({ id, thresholdHours, tick, onClose }: { id: string | null; thresholdHours: number; tick: number; onClose: () => void }) {
  return (
    <Modal open={!!id} onClose={onClose} title="Худалдан авалтын дэлгэрэнгүй" description="Зөвхөн харах горим — энд ямар ч үйлдэл хийх боломжгүй" className="max-w-5xl">
      {id && <Body id={id} thresholdHours={thresholdHours} tick={tick} />}
    </Modal>
  );
}

function Body({ id, thresholdHours, tick }: { id: string; thresholdHours: number; tick: number }) {
  const s = useLiveData<ProcurementDetail>(`${API}/procurement-detail?id=${encodeURIComponent(id)}&thresholdHours=${thresholdHours}`, tick);
  const [tab, setTab] = useState<"items" | "purchases" | "timeline" | "handovers">("items");
  if (s.loading) return <p className="px-5 py-10 text-center text-sm text-text-muted">Ачаалж байна…</p>;
  if (s.error && !s.data) return <p role="alert" className="px-5 py-10 text-center text-sm text-danger">{s.error}</p>;
  const d = s.data;
  if (!d) return null;
  const r = d.row;
  const name = new Map(r.items.map((i) => [i.itemId, i.materialName]));
  const unit = new Map(r.items.map((i) => [i.itemId, i.unit]));
  const dur = (x: number | null) => (x === null ? "—" : formatDuration(x));

  const TABS = [
    ["items", "Материал"],
    ["purchases", `Худалдан авалт (${d.purchases.length})`],
    ["timeline", "Үйл явдлын түүх"],
    ["handovers", `Шилжүүлэлт (${d.handovers.length})`],
  ] as const;

  return (
    <div className="max-h-[75vh] overflow-y-auto">
      <div className="space-y-3 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-text">№{r.requestNumber}</span>
          <span className="text-xs text-text-muted">{r.department} · {r.requestedBy}</span>
          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", STAGE_TONE[r.stage])}>{STAGE_LABEL[r.stage]}</span>
          {r.partiallyPurchased && <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning">хэсэгчлэн авсан</span>}
          <span className="ml-auto text-[11px] text-text-muted">ID: {r.requestId}</span>
        </div>

        <dl className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
          {[
            ["Баталсан (CEO)", r.enteredAt ? formatUB(r.enteredAt) : "тодорхойгүй"],
            ["Ангилал баталгаажсан", d.classification ? `${formatUB(d.classification.confirmedAt)} · ${d.classification.confirmedByName}` : "—"],
            ["Ангилал хүлээсэн хугацаа", dur(r.classificationWaitSeconds)],
            ["Сүүлийн үйлдлээс хойш", dur(r.idleSeconds)],
            ["Явц", r.completionPercent === null ? "—" : `${r.completionPercent}% (${r.completionBasis === "value" ? "үнэ цэнээр" : "материалын тоогоор"})`],
            ["Материал (авсан/нийт)", `${r.completeItems}/${r.requiredItems}`],
            ["Бодит зардал", r.actualCost > 0 ? formatCurrency(r.actualCost) : "—"],
            ["Дууссан", r.completedAt ? formatUB(r.completedAt) : "—"],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-border bg-bg-elevated/40 p-2">
              <dt className="text-[10px] text-text-muted">{k}</dt>
              <dd className="mt-0.5 text-text">{v}</dd>
            </div>
          ))}
        </dl>

        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {([r.domestic, r.international] as const).map((t, idx) => {
            const kind = idx === 0 ? "DOMESTIC" : "INTERNATIONAL";
            return (
              <div key={kind} className="rounded-lg border border-border p-3 text-xs">
                <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", KIND_TONE[kind])}>{KIND_LABEL[kind]} урсгал</span>
                {t ? (
                  <p className="mt-2 text-text">
                    {t.totalItems - t.outstandingItems}/{t.totalItems} материал бүрэн · хариуцагч: {t.managers.join(", ") || "—"} · зардал {t.actualCost > 0 ? formatCurrency(t.actualCost) : "—"}
                  </p>
                ) : (
                  <p className="mt-2 text-text-muted">Энэ урсгалд материал алга</p>
                )}
              </div>
            );
          })}
        </div>
        {r.unassignedOutstandingItems > 0 && <p className="text-xs text-warning">{r.unassignedOutstandingItems} дутуу материал хуваарилагдаагүй байна.</p>}
      </div>

      <div role="tablist" className="flex gap-1 border-b border-border px-5">
        {TABS.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} type="button" onClick={() => setTab(key)} className={cn("focus-ring -mb-px border-b-2 px-3 py-2 text-xs", tab === key ? "border-accent text-text" : "border-transparent text-text-muted hover:text-text")}>
            {label}
          </button>
        ))}
      </div>

      {tab === "items" && <ItemsTable items={r.items} />}

      {tab === "purchases" && (
        <DataGrid
          head={
            <>
              <Th>Огноо (УБ)</Th>
              <Th>Материал</Th>
              <Th className="text-right">Тоо</Th>
              <Th className="text-right">Нэгж үнэ</Th>
              <Th className="text-right">Дүн</Th>
              <Th>Бүртгэсэн</Th>
              <Th>Төлөв</Th>
            </>
          }
          empty={d.purchases.length === 0 && "Худалдан авалтын бичлэг алга"}
        >
          {d.purchases.map((p) => (
            <tr key={p.id} className={cn(p.voided && "text-text-muted line-through decoration-text-muted/60")}>
              <Td className="whitespace-nowrap">{formatUB(p.purchasedAt)}</Td>
              <Td>{name.get(p.itemId) ?? "—"}</Td>
              <Td className="whitespace-nowrap text-right">{qty(p.quantity)} {unit.get(p.itemId)}</Td>
              <Td className="text-right">{formatCurrency(p.unitPrice)}</Td>
              <Td className="text-right">{formatCurrency(p.total)}</Td>
              <Td>{p.purchasedByName}</Td>
              <Td className="no-underline">
                {p.voided ? <span title={p.voidReason ?? undefined}>Хүчингүй · {p.voidedByName ?? "—"}{p.voidReason ? ` · ${p.voidReason}` : ""}</span> : p.replacesId ? "Залруулсан" : "Идэвхтэй"}
              </Td>
            </tr>
          ))}
        </DataGrid>
      )}

      {tab === "timeline" && (
        <>
          {d.timelineTruncated && <p className="px-5 py-2 text-xs text-warning">Түүх урт тул сүүлийн 200 үйл явдлыг харуулав.</p>}
          <DataGrid
            head={
              <>
                <Th>Огноо (УБ)</Th>
                <Th>Хэн</Th>
                <Th>Үйлдэл</Th>
                <Th>Тайлбар</Th>
              </>
            }
            empty={d.timeline.length === 0 && "Үйл явдал алга"}
          >
            {d.timeline.map((e) => (
              <tr key={e.id}>
                <Td className="whitespace-nowrap text-text-muted">{formatUB(e.at)}</Td>
                <Td>{e.actorName}</Td>
                <Td>{PROCUREMENT_ACTION_LABEL[e.action] ?? e.action}</Td>
                <Td className="text-text-muted">{e.summary ?? "—"}</Td>
              </tr>
            ))}
          </DataGrid>
        </>
      )}

      {tab === "handovers" && (
        <DataGrid
          head={
            <>
              <Th>Огноо (УБ)</Th>
              <Th>Материал</Th>
              <Th>Хэнээс</Th>
              <Th>Хэнд</Th>
              <Th>Шилжүүлсэн</Th>
              <Th>Шалтгаан</Th>
            </>
          }
          empty={d.handovers.length === 0 && "Хариуцагч шилжүүлсэн түүх алга"}
        >
          {d.handovers.map((h) => (
            <tr key={h.id}>
              <Td className="whitespace-nowrap text-text-muted">{formatUB(h.at)}</Td>
              <Td>
                {h.materialName}
                {h.kind && <span className={cn("ml-1 rounded px-1 text-[10px]", KIND_TONE[h.kind])}>{KIND_LABEL[h.kind]}</span>}
              </Td>
              <Td>{h.fromManagerName ?? "—"}</Td>
              <Td>{h.toManagerName ?? "—"}</Td>
              <Td>{h.actorName}{h.handoverId ? " (админ шилжүүлэлт)" : " (дахин хуваарилалт)"}</Td>
              <Td className="text-text-muted">{h.reason ?? "—"}</Td>
            </tr>
          ))}
        </DataGrid>
      )}
    </div>
  );
}
