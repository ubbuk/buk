-- Admin department management: a department with request history cannot be deleted, so it is archived instead.
-- Additive only: one nullable column on "Department", no data change.

-- AlterTable
ALTER TABLE "Department" ADD COLUMN "archivedAt" TIMESTAMP(3);
