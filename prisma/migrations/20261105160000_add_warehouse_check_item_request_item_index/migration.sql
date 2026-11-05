-- Additive only: one new index, no table/column/row/constraint touched.
-- The procurement workload and monitoring queries look up the latest warehouse check of an
-- item by "requestItemId" alone; the only index (warehouseCheckId, requestItemId) cannot serve that,
-- so every item triggered a full scan of "WarehouseCheckItem".

-- CreateIndex
CREATE INDEX "WarehouseCheckItem_requestItemId_idx" ON "WarehouseCheckItem"("requestItemId");
