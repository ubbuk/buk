-- Executive partial approval & deferred procurement.
--
-- Additive only: two enums and four new tables. No existing table, column, row,
-- constraint or index is touched, so it is safe on a database that already holds
-- data and backward compatible with the previous application version (which
-- never reads or writes any of this). Requests approved before this migration
-- get no rows: the application reads "approved, no decision rows" as fully
-- authorised, so nothing is backfilled.

-- CreateEnum
CREATE TYPE "ExecutiveDecisionKind" AS ENUM ('INITIAL_FULL', 'INITIAL_PARTIAL', 'SUBSEQUENT', 'DEFERRED_RETURN');

-- CreateEnum
CREATE TYPE "DeferredApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'PARTIALLY_APPROVED', 'RETURNED');

-- CreateTable
CREATE TABLE "DeferredApprovalRequest" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "status" "DeferredApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientRequestId" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionComment" TEXT,

    CONSTRAINT "DeferredApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutiveApprovalDecision" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "kind" "ExecutiveDecisionKind" NOT NULL,
    "decidedById" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comment" TEXT,
    "clientRequestId" TEXT,
    "deferredRequestId" TEXT,
    "requiredTotal" DECIMAL(14,3) NOT NULL,
    "approvedTotalAfter" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "ExecutiveApprovalDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutiveApprovalAllocation" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "requestItemId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "requiredQuantity" DECIMAL(14,3) NOT NULL,
    "cumulativeAfter" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "ExecutiveApprovalAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeferredApprovalRequestItem" (
    "id" TEXT NOT NULL,
    "deferredRequestId" TEXT NOT NULL,
    "requestItemId" TEXT NOT NULL,
    "requestedQuantity" DECIMAL(14,3) NOT NULL,
    "approvedQuantity" DECIMAL(14,3),

    CONSTRAINT "DeferredApprovalRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeferredApprovalRequest_requestId_status_idx" ON "DeferredApprovalRequest"("requestId", "status");
CREATE UNIQUE INDEX "DeferredApprovalRequest_requestId_clientRequestId_key" ON "DeferredApprovalRequest"("requestId", "clientRequestId");
CREATE UNIQUE INDEX "ExecutiveApprovalDecision_deferredRequestId_key" ON "ExecutiveApprovalDecision"("deferredRequestId");
CREATE INDEX "ExecutiveApprovalDecision_decidedById_idx" ON "ExecutiveApprovalDecision"("decidedById");
CREATE UNIQUE INDEX "ExecutiveApprovalDecision_requestId_sequence_key" ON "ExecutiveApprovalDecision"("requestId", "sequence");
CREATE UNIQUE INDEX "ExecutiveApprovalDecision_requestId_clientRequestId_key" ON "ExecutiveApprovalDecision"("requestId", "clientRequestId");
CREATE INDEX "ExecutiveApprovalAllocation_requestItemId_idx" ON "ExecutiveApprovalAllocation"("requestItemId");
CREATE UNIQUE INDEX "ExecutiveApprovalAllocation_decisionId_requestItemId_key" ON "ExecutiveApprovalAllocation"("decisionId", "requestItemId");
CREATE INDEX "DeferredApprovalRequestItem_requestItemId_idx" ON "DeferredApprovalRequestItem"("requestItemId");
CREATE UNIQUE INDEX "DeferredApprovalRequestItem_deferredRequestId_requestItemId_key" ON "DeferredApprovalRequestItem"("deferredRequestId", "requestItemId");

-- At most one pending procurement-officer request per material request, enforced by the database.
CREATE UNIQUE INDEX "DeferredApprovalRequest_one_pending_per_request" ON "DeferredApprovalRequest"("requestId") WHERE "status" = 'PENDING';

-- AddForeignKey
ALTER TABLE "DeferredApprovalRequest" ADD CONSTRAINT "DeferredApprovalRequest_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "MaterialRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeferredApprovalRequest" ADD CONSTRAINT "DeferredApprovalRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DeferredApprovalRequest" ADD CONSTRAINT "DeferredApprovalRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ExecutiveApprovalDecision" ADD CONSTRAINT "ExecutiveApprovalDecision_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "MaterialRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExecutiveApprovalDecision" ADD CONSTRAINT "ExecutiveApprovalDecision_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExecutiveApprovalDecision" ADD CONSTRAINT "ExecutiveApprovalDecision_deferredRequestId_fkey" FOREIGN KEY ("deferredRequestId") REFERENCES "DeferredApprovalRequest"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "ExecutiveApprovalAllocation" ADD CONSTRAINT "ExecutiveApprovalAllocation_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "ExecutiveApprovalDecision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExecutiveApprovalAllocation" ADD CONSTRAINT "ExecutiveApprovalAllocation_requestItemId_fkey" FOREIGN KEY ("requestItemId") REFERENCES "MaterialRequestItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeferredApprovalRequestItem" ADD CONSTRAINT "DeferredApprovalRequestItem_deferredRequestId_fkey" FOREIGN KEY ("deferredRequestId") REFERENCES "DeferredApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeferredApprovalRequestItem" ADD CONSTRAINT "DeferredApprovalRequestItem_requestItemId_fkey" FOREIGN KEY ("requestItemId") REFERENCES "MaterialRequestItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Quantity sanity (the application validates first; these are the last line of defence).
ALTER TABLE "ExecutiveApprovalAllocation" ADD CONSTRAINT "ExecutiveApprovalAllocation_quantity_valid" CHECK ("quantity" > 0 AND "cumulativeAfter" <= "requiredQuantity");
ALTER TABLE "DeferredApprovalRequestItem" ADD CONSTRAINT "DeferredApprovalRequestItem_quantities_valid" CHECK ("requestedQuantity" > 0 AND ("approvedQuantity" IS NULL OR "approvedQuantity" >= 0));

-- Decisions are immutable historical events: UPDATE is always rejected, and so is deleting a
-- decision (or one of its allocations) while its material request still exists. They only
-- disappear together with the request itself (ON DELETE CASCADE, development/test clean-up):
-- the cascade runs after the request row is gone, which is what the check below sees.
CREATE FUNCTION "executive_approval_immutable"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF TG_TABLE_NAME = 'ExecutiveApprovalDecision' THEN
      IF NOT EXISTS (SELECT 1 FROM "MaterialRequest" WHERE "id" = OLD."requestId") THEN RETURN OLD; END IF;
    ELSIF NOT EXISTS (
      SELECT 1 FROM "ExecutiveApprovalDecision" d JOIN "MaterialRequest" r ON r."id" = d."requestId" WHERE d."id" = OLD."decisionId"
    ) THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION '% rows are immutable (% rejected)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ExecutiveApprovalDecision_immutable" BEFORE UPDATE OR DELETE ON "ExecutiveApprovalDecision"
  FOR EACH ROW EXECUTE FUNCTION "executive_approval_immutable"();
CREATE TRIGGER "ExecutiveApprovalAllocation_immutable" BEFORE UPDATE OR DELETE ON "ExecutiveApprovalAllocation"
  FOR EACH ROW EXECUTE FUNCTION "executive_approval_immutable"();
