"use client";

import type { MonitoredItem } from "@/lib/monitoring/procurement-types";
import { cn, formatCurrency } from "@/lib/utils";
import { formatUB } from "./format";
import { DataGrid, Td, Th } from "./Panel";
import { ITEM_STATUS_LABEL, ITEM_STATUS_TONE, KIND_LABEL, KIND_TONE, qty } from "./procurement-ui";

export function ItemsTable({ items }: { items: MonitoredItem[] }) {
  return (
    <DataGrid
      head={
        <>
          <Th>Материал</Th>
          <Th>Ангилал / менежер</Th>
          <Th className="text-right">Захиалсан</Th>
          <Th className="text-right">Агуулахаас</Th>
          <Th className="text-right">Худалдан авах</Th>
          <Th className="text-right">Авсан</Th>
          <Th className="text-right">Үлдэгдэл</Th>
          <Th>Төлөв</Th>
          <Th className="text-right">Бодит зардал</Th>
          <Th>Сүүлийн үйлдэл</Th>
        </>
      }
      empty={items.length === 0 && "Материал алга"}
    >
      {items.map((i) => (
        <tr key={i.itemId}>
          <Td className="font-medium">{i.materialName}</Td>
          <Td>
            {i.kind ? (
              <>
                <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", KIND_TONE[i.kind])}>{KIND_LABEL[i.kind]}</span>
                <span className="ml-1 text-[11px] text-text-muted">{i.managerName}</span>
              </>
            ) : i.required > 0 ? (
              <span className="text-[11px] text-text-muted">Хуваарилаагүй</span>
            ) : (
              <span className="text-text-muted">—</span>
            )}
          </Td>
          <Td className="whitespace-nowrap text-right">{qty(i.requested)} {i.unit}</Td>
          <Td className="whitespace-nowrap text-right">{qty(i.warehouseIssued)} {i.unit}</Td>
          <Td className="whitespace-nowrap text-right">{qty(i.required)} {i.unit}</Td>
          <Td className="whitespace-nowrap text-right">{qty(i.purchased)} {i.unit}</Td>
          <Td className="whitespace-nowrap text-right">{qty(i.outstanding)} {i.unit}</Td>
          <Td>
            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", ITEM_STATUS_TONE[i.status])}>{ITEM_STATUS_LABEL[i.status]}</span>
          </Td>
          <Td className="whitespace-nowrap text-right">{i.activePurchases > 0 ? formatCurrency(i.actualCost) : "—"}</Td>
          <Td className="whitespace-nowrap text-text-muted">{i.lastActivityAt ? formatUB(i.lastActivityAt) : "—"}</Td>
        </tr>
      ))}
    </DataGrid>
  );
}
