-- Warehouse hierarchy (top-level warehouse -> locations), per-warehouse keeper, 1С code and reservation priority,
-- plus a small SystemSetting table. Additive only: every new Warehouse column is nullable or has a default, so existing
-- rows, InventoryBalance and StockReservation data are untouched.

-- AlterTable
ALTER TABLE "Warehouse" ADD COLUMN     "slug" TEXT,
ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "keeperId" TEXT,
ADD COLUMN     "onecCode" TEXT,
ADD COLUMN     "sortPriority" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_slug_key" ON "Warehouse"("slug");

-- CreateIndex
CREATE INDEX "Warehouse_parentId_idx" ON "Warehouse"("parentId");

-- CreateIndex
CREATE INDEX "Warehouse_keeperId_idx" ON "Warehouse"("keeperId");

-- The warehouse every existing stock row points at becomes the "Төв агуулах" location, first in reservation order.
-- No-op when the row does not exist. The parent (Ууганцэцэг) and the rest of the structure come from the seed
-- (prisma/warehouse-structure.ts), which re-parents this row.
UPDATE "Warehouse" SET "slug" = 'tov-aguulah', "sortPriority" = 10 WHERE "id" = 'w-central';

-- AddForeignKey
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_keeperId_fkey" FOREIGN KEY ("keeperId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
