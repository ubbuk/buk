-- Warehouse.reservable: false keeps a warehouse (e.g. finished goods) visible but never reserved from for a material
-- request. Additive: one NOT NULL column with a default, so every existing row stays reservable.

-- AlterTable
ALTER TABLE "Warehouse" ADD COLUMN     "reservable" BOOLEAN NOT NULL DEFAULT true;
