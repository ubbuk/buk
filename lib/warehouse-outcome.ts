import type { MaterialRequestItemView, MaterialRequestView } from "./types";

// What the storekeeper is told after a warehouse check. It is read from the request the SERVER returned (what was
// really issued and what is still missing), never guessed from the numbers typed in: a line that is not linked to the
// catalog has no stock to issue from, whatever count was typed, and the page used to announce "done" regardless.

export const UNLINKED_LINE_NOTE = "Каталогт холбогдоогүй тул агуулахаас олгох боломжгүй";

/** A hand-typed line (no material of the catalog): the warehouse has nothing to issue it from. */
export const isUnlinkedLine = (item: Pick<MaterialRequestItemView, "materialId">) => item.materialId === null;

export interface WarehouseOutcome {
  kind: "success" | "warning";
  title: string;
  description?: string;
}

export function warehouseOutcome(request: Pick<MaterialRequestView, "items">): WarehouseOutcome {
  const missing = request.items.filter((i) => (i.missingQuantity ?? 0) > 0);
  if (missing.length === 0) return { kind: "success", title: "Бүгд олгогдлоо, дууслаа", description: "Бүх материал агуулахаас олгогдсон тул захиалга дуусгавар боллоо" };

  const issued = request.items.filter((i) => (i.allocatedQuantity ?? 0) > 0).length;
  const unlinked = missing.filter(isUnlinkedLine).length;
  const parts = [
    issued > 0 ? `${issued} мөр агуулахаас олгогдлоо` : null,
    unlinked > 0 ? `${unlinked} мөр каталогт холбогдоогүй тул агуулахаас олгох боломжгүй` : null,
    unlinked < missing.length ? `${missing.length - unlinked} мөрийн үлдэгдэл хүрэлцсэнгүй` : null,
  ].filter(Boolean);
  return { kind: "warning", title: `${missing.length} мөр дутуу — худалдан авалт руу явлаа`, description: parts.join(" · ") || undefined };
}
