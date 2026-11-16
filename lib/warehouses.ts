import { prisma } from "./prisma";
import type { WarehouseGroup } from "./warehouse-structure";

/**
 * The warehouse catalog as the /warehouses pages show it: every active top-level warehouse with its active
 * locations. A top-level warehouse without locations (e.g. "Гадна талбай") is shown as a single location of itself.
 * Group and location ids are the stable slugs (fallback: the row id for rows created outside the seed).
 */
export async function getWarehouseTree(): Promise<WarehouseGroup[]> {
  const tops = await prisma.warehouse.findMany({
    where: { parentId: null, isActive: true },
    include: {
      keeper: { select: { name: true } },
      children: { where: { isActive: true }, orderBy: [{ sortPriority: "asc" }, { name: "asc" }] },
    },
    orderBy: [{ name: "asc" }],
  });
  return tops.map((top) => {
    const groupId = top.slug ?? top.id;
    const locations = top.children.length > 0 ? top.children : [top];
    return {
      id: groupId,
      name: top.name,
      keeperName: top.keeper?.name ?? null,
      warehouses: locations.map((l) => ({ id: l.slug ?? l.id, name: l.name, onecCode: l.onecCode })),
    };
  });
}
