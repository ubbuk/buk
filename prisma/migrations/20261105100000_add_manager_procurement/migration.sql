-- Manager procurement stage (between CEO approval and Chief Accountant registration).
--
-- Additive only: new enum values and one new table. No existing column, row,
-- constraint or index is touched, so it is safe to apply to a database that
-- already holds data and is backward compatible with the previous application
-- version (which never reads or writes any of this).
--
-- Existing requests are NOT rewritten: a request that is already
-- PENDING_ACCOUNTING keeps going straight to the Chief Accountant; one still
-- at PENDING_EXECUTIVE_APPROVAL gets its MANAGER_PROCUREMENT step created by
-- the application when the CEO approves (see lib/workflow.ts).
--
-- Note: ALTER TYPE ... ADD VALUE cannot be used by statements in the same
-- transaction, and nothing below uses the new values. Adding several values in
-- one migration needs PostgreSQL 12+ (the project runs postgres:16).

-- AlterEnum
ALTER TYPE "RequestStatus" ADD VALUE 'PENDING_PROCUREMENT';

-- AlterEnum
ALTER TYPE "ApprovalStepType" ADD VALUE 'MANAGER_PROCUREMENT';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PROCUREMENT_REQUIRED';

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'PROCUREMENT_PURCHASE';
ALTER TYPE "AuditAction" ADD VALUE 'PROCUREMENT_VOID';
ALTER TYPE "AuditAction" ADD VALUE 'PROCUREMENT_COMPLETE';

-- CreateTable
CREATE TABLE "ProcurementPurchase" (
    "id" TEXT NOT NULL,
    "requestItemId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "clientRequestId" TEXT,
    "purchasedById" TEXT NOT NULL,
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replacesId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "ProcurementPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProcurementPurchase_replacesId_key" ON "ProcurementPurchase"("replacesId");

-- CreateIndex
CREATE INDEX "ProcurementPurchase_requestItemId_voidedAt_idx" ON "ProcurementPurchase"("requestItemId", "voidedAt");

-- CreateIndex
CREATE INDEX "ProcurementPurchase_purchasedAt_idx" ON "ProcurementPurchase"("purchasedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProcurementPurchase_requestItemId_clientRequestId_key" ON "ProcurementPurchase"("requestItemId", "clientRequestId");

-- AddForeignKey
ALTER TABLE "ProcurementPurchase" ADD CONSTRAINT "ProcurementPurchase_requestItemId_fkey" FOREIGN KEY ("requestItemId") REFERENCES "MaterialRequestItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcurementPurchase" ADD CONSTRAINT "ProcurementPurchase_purchasedById_fkey" FOREIGN KEY ("purchasedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcurementPurchase" ADD CONSTRAINT "ProcurementPurchase_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcurementPurchase" ADD CONSTRAINT "ProcurementPurchase_replacesId_fkey" FOREIGN KEY ("replacesId") REFERENCES "ProcurementPurchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
