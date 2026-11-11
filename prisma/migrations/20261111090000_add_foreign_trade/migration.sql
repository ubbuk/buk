-- CreateEnum
CREATE TYPE "ForeignTradeStatus" AS ENUM ('DRAFT', 'PENDING_MANAGER', 'PENDING_TECHNICAL', 'RETURNED_TO_MANAGER', 'PENDING_FINANCE', 'PENDING_EXECUTIVE', 'RETURNED_TO_BOSS', 'APPROVED');

-- CreateEnum
CREATE TYPE "ForeignTradeStage" AS ENUM ('TECHNICAL', 'FINANCE', 'EXECUTIVE');

-- CreateEnum
CREATE TYPE "ForeignTradeDecisionAction" AS ENUM ('APPROVE', 'RETURN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'FT_QUOTE_ADD';
ALTER TYPE "AuditAction" ADD VALUE 'FT_QUOTE_UPDATE';
ALTER TYPE "AuditAction" ADD VALUE 'FT_QUOTE_DELETE';
ALTER TYPE "AuditAction" ADD VALUE 'FT_SHARE';
ALTER TYPE "AuditAction" ADD VALUE 'FT_SELECT_SUPPLIER';
ALTER TYPE "AuditAction" ADD VALUE 'FT_MESSAGE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'FOREIGN_TRADE_DISCUSSION';
ALTER TYPE "NotificationType" ADD VALUE 'FOREIGN_TRADE_APPROVAL';
ALTER TYPE "NotificationType" ADD VALUE 'FOREIGN_TRADE_UPDATE';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "relatedForeignTradeId" TEXT;

-- CreateTable
CREATE TABLE "ForeignTradeOrder" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "departmentId" TEXT,
    "status" "ForeignTradeStatus" NOT NULL DEFAULT 'DRAFT',
    "purpose" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "cycle" INTEGER NOT NULL DEFAULT 0,
    "sharedWithBoss" BOOLEAN NOT NULL DEFAULT false,
    "sharedWithTechnical" BOOLEAN NOT NULL DEFAULT false,
    "selectedQuoteId" TEXT,
    "selectionRationale" TEXT,
    "selectedById" TEXT,
    "selectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "ForeignTradeOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForeignTradeItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "techSpec" TEXT,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" TEXT NOT NULL,

    CONSTRAINT "ForeignTradeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForeignTradeQuote" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "price" DECIMAL(16,2) NOT NULL,
    "shippingCost" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "leadTimeDays" INTEGER,
    "warranty" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ForeignTradeQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForeignTradeMessage" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "quoteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForeignTradeMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForeignTradeDecision" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL,
    "stage" "ForeignTradeStage" NOT NULL,
    "action" "ForeignTradeDecisionAction" NOT NULL,
    "decidedById" TEXT NOT NULL,
    "reason" TEXT,
    "selectedQuoteId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForeignTradeDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForeignTradeAttachment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "quoteId" TEXT,
    "messageId" TEXT,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForeignTradeAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ForeignTradeOrder_orderNumber_key" ON "ForeignTradeOrder"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ForeignTradeOrder_selectedQuoteId_key" ON "ForeignTradeOrder"("selectedQuoteId");

-- CreateIndex
CREATE INDEX "ForeignTradeOrder_createdById_idx" ON "ForeignTradeOrder"("createdById");

-- CreateIndex
CREATE INDEX "ForeignTradeOrder_status_idx" ON "ForeignTradeOrder"("status");

-- CreateIndex
CREATE INDEX "ForeignTradeOrder_createdAt_idx" ON "ForeignTradeOrder"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ForeignTradeOrder_year_sequence_key" ON "ForeignTradeOrder"("year", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ForeignTradeItem_orderId_lineNo_key" ON "ForeignTradeItem"("orderId", "lineNo");

-- CreateIndex
CREATE INDEX "ForeignTradeQuote_orderId_idx" ON "ForeignTradeQuote"("orderId");

-- CreateIndex
CREATE INDEX "ForeignTradeMessage_orderId_createdAt_idx" ON "ForeignTradeMessage"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "ForeignTradeDecision_decidedById_idx" ON "ForeignTradeDecision"("decidedById");

-- CreateIndex
CREATE UNIQUE INDEX "ForeignTradeDecision_orderId_cycle_stage_key" ON "ForeignTradeDecision"("orderId", "cycle", "stage");

-- CreateIndex
CREATE INDEX "ForeignTradeAttachment_orderId_idx" ON "ForeignTradeAttachment"("orderId");

-- CreateIndex
CREATE INDEX "Notification_relatedForeignTradeId_idx" ON "Notification"("relatedForeignTradeId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_relatedForeignTradeId_fkey" FOREIGN KEY ("relatedForeignTradeId") REFERENCES "ForeignTradeOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForeignTradeOrder" ADD CONSTRAINT "ForeignTradeOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForeignTradeOrder" ADD CONSTRAINT "ForeignTradeOrder_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForeignTradeOrder" ADD CONSTRAINT "ForeignTradeOrder_selectedById_fkey" FOREIGN KEY ("selectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForeignTradeOrder" ADD CONSTRAINT "ForeignTradeOrder_selectedQuoteId_fkey" FOREIGN KEY ("selectedQuoteId") REFERENCES "ForeignTradeQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForeignTradeItem" ADD CONSTRAINT "ForeignTradeItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ForeignTradeOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForeignTradeQuote" ADD CONSTRAINT "ForeignTradeQuote_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ForeignTradeOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForeignTradeQuote" ADD CONSTRAINT "ForeignTradeQuote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForeignTradeMessage" ADD CONSTRAINT "ForeignTradeMessage_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ForeignTradeOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForeignTradeMessage" ADD CONSTRAINT "ForeignTradeMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForeignTradeMessage" ADD CONSTRAINT "ForeignTradeMessage_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "ForeignTradeQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForeignTradeDecision" ADD CONSTRAINT "ForeignTradeDecision_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ForeignTradeOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForeignTradeDecision" ADD CONSTRAINT "ForeignTradeDecision_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForeignTradeAttachment" ADD CONSTRAINT "ForeignTradeAttachment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ForeignTradeOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForeignTradeAttachment" ADD CONSTRAINT "ForeignTradeAttachment_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "ForeignTradeQuote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForeignTradeAttachment" ADD CONSTRAINT "ForeignTradeAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ForeignTradeMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForeignTradeAttachment" ADD CONSTRAINT "ForeignTradeAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

