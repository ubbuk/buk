-- CreateEnum
CREATE TYPE "PurchaseReceiptKind" AS ENUM ('WAYBILL', 'INVOICE', 'VAT_RECEIPT', 'CASH_RECEIPT', 'OTHER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'PURCHASE_RECEIPT_ADD';
ALTER TYPE "AuditAction" ADD VALUE 'PURCHASE_RECEIPT_REMOVE';
ALTER TYPE "AuditAction" ADD VALUE 'PURCHASE_RECEIPT_WAIVE';
ALTER TYPE "AuditAction" ADD VALUE 'PROCUREMENT_RETURN';

-- CreateTable
CREATE TABLE "PurchaseReceipt" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "requestItemId" TEXT,
    "kind" "PurchaseReceiptKind" NOT NULL,
    "supplierName" TEXT,
    "receiptNumber" TEXT,
    "receiptDate" TIMESTAMP(3),
    "amount" DECIMAL(14,2),
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "thumbKey" TEXT,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseReceiptWaiver" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "requestItemId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "waivedById" TEXT NOT NULL,
    "waivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseReceiptWaiver_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseReceipt_requestId_idx" ON "PurchaseReceipt"("requestId");

-- CreateIndex
CREATE INDEX "PurchaseReceipt_requestItemId_idx" ON "PurchaseReceipt"("requestItemId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseReceiptWaiver_requestItemId_key" ON "PurchaseReceiptWaiver"("requestItemId");

-- CreateIndex
CREATE INDEX "PurchaseReceiptWaiver_requestId_idx" ON "PurchaseReceiptWaiver"("requestId");

-- AddForeignKey
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "MaterialRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_requestItemId_fkey" FOREIGN KEY ("requestItemId") REFERENCES "MaterialRequestItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceipt" ADD CONSTRAINT "PurchaseReceipt_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceiptWaiver" ADD CONSTRAINT "PurchaseReceiptWaiver_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "MaterialRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceiptWaiver" ADD CONSTRAINT "PurchaseReceiptWaiver_requestItemId_fkey" FOREIGN KEY ("requestItemId") REFERENCES "MaterialRequestItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReceiptWaiver" ADD CONSTRAINT "PurchaseReceiptWaiver_waivedById_fkey" FOREIGN KEY ("waivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

