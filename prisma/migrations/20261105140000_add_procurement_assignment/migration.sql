-- Domestic / International procurement assignment (builds on 20261105100000_add_manager_procurement).
--
-- Additive only: one new enum, new enum values and two new tables. No existing
-- column, row, constraint or index is touched, so it is safe on a database that
-- already holds data and is backward compatible with the previous application
-- version (which never reads or writes any of this).
--
-- Existing requests are NOT rewritten. A request that is already in procurement
-- simply has no classification row yet; the application then asks the
-- International manager to classify it before further purchases are recorded
-- (existing purchase rows are never modified). Until both procurement managers
-- are configured by an ADMIN (Admin > approval positions) the application keeps
-- the previous behaviour, so deploying this migration alone changes nothing.
--
-- Note: ALTER TYPE ... ADD VALUE cannot be used by statements in the same
-- transaction, and nothing below uses the new values. Adding several values in
-- one migration needs PostgreSQL 12+ (the project runs postgres:16).

-- CreateEnum
CREATE TYPE "ProcurementKind" AS ENUM ('DOMESTIC', 'INTERNATIONAL');

-- AlterEnum
ALTER TYPE "ApprovalPosition" ADD VALUE 'DOMESTIC_PROCUREMENT_MANAGER';
ALTER TYPE "ApprovalPosition" ADD VALUE 'INTERNATIONAL_PROCUREMENT_MANAGER';

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'PROCUREMENT_CLASSIFY';
ALTER TYPE "AuditAction" ADD VALUE 'PROCUREMENT_REASSIGN';

-- CreateTable
CREATE TABLE "ProcurementClassification" (
    "requestId" TEXT NOT NULL,
    "confirmedById" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcurementClassification_pkey" PRIMARY KEY ("requestId")
);

-- CreateTable
CREATE TABLE "ProcurementItemAssignment" (
    "requestItemId" TEXT NOT NULL,
    "kind" "ProcurementKind" NOT NULL,
    "assignedManagerId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcurementItemAssignment_pkey" PRIMARY KEY ("requestItemId")
);

-- CreateIndex
CREATE INDEX "ProcurementItemAssignment_assignedManagerId_idx" ON "ProcurementItemAssignment"("assignedManagerId");

-- AddForeignKey
ALTER TABLE "ProcurementClassification" ADD CONSTRAINT "ProcurementClassification_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "MaterialRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcurementClassification" ADD CONSTRAINT "ProcurementClassification_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcurementItemAssignment" ADD CONSTRAINT "ProcurementItemAssignment_requestItemId_fkey" FOREIGN KEY ("requestItemId") REFERENCES "MaterialRequestItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcurementItemAssignment" ADD CONSTRAINT "ProcurementItemAssignment_assignedManagerId_fkey" FOREIGN KEY ("assignedManagerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
