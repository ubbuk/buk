// Shapes for the warehouse catalog browser (/warehouses). The groups (keeper level) and their warehouses (1С warehouses)
// come from the database: lib/warehouses.ts.
export interface SubWarehouse {
  id: string;
  name: string;
  /** The 1С warehouse code; null for a warehouse that is not mapped to 1С. */
  onecCode: string | null;
}

export interface WarehouseGroup {
  id: string;
  name: string;
  /** Name of the keeper of this top-level warehouse; null when nobody keeps it. */
  keeperName: string | null;
  warehouses: SubWarehouse[];
}

export function findWarehouseGroup(groups: WarehouseGroup[], groupId: string) {
  return groups.find((g) => g.id === groupId) ?? null;
}

export function findSubWarehouse(groups: WarehouseGroup[], groupId: string, warehouseId: string) {
  const group = findWarehouseGroup(groups, groupId);
  if (!group) return null;
  const warehouse = group.warehouses.find((w) => w.id === warehouseId) ?? null;
  if (!warehouse) return null;
  return { group, warehouse };
}
