-- Executive reassignment (builds on 20261109100000_add_executive_partial_approval).
--
-- Additive only: one new table. The immutability function created by the previous migration
-- is replaced (CREATE OR REPLACE) with a version that also covers the new table; behaviour for
-- the two existing tables is unchanged. No existing table, column, row or index is touched.

-- CreateTable
CREATE TABLE "ExecutiveApprovalReassignment" (
    "id" TEXT NOT NULL,
    "handoverKey" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "reassignedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "stepStatusBefore" TEXT NOT NULL,
    "requestStatusBefore" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutiveApprovalReassignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExecutiveApprovalReassignment_requestId_createdAt_idx" ON "ExecutiveApprovalReassignment"("requestId", "createdAt");
CREATE UNIQUE INDEX "ExecutiveApprovalReassignment_handoverKey_requestId_key" ON "ExecutiveApprovalReassignment"("handoverKey", "requestId");

-- AddForeignKey
ALTER TABLE "ExecutiveApprovalReassignment" ADD CONSTRAINT "ExecutiveApprovalReassignment_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "MaterialRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExecutiveApprovalReassignment" ADD CONSTRAINT "ExecutiveApprovalReassignment_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExecutiveApprovalReassignment" ADD CONSTRAINT "ExecutiveApprovalReassignment_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExecutiveApprovalReassignment" ADD CONSTRAINT "ExecutiveApprovalReassignment_reassignedById_fkey" FOREIGN KEY ("reassignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Immutable like the decisions: UPDATE is always rejected; DELETE only together with the request itself.
CREATE OR REPLACE FUNCTION "executive_approval_immutable"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF TG_TABLE_NAME IN ('ExecutiveApprovalDecision', 'ExecutiveApprovalReassignment') THEN
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

CREATE TRIGGER "ExecutiveApprovalReassignment_immutable" BEFORE UPDATE OR DELETE ON "ExecutiveApprovalReassignment"
  FOR EACH ROW EXECUTE FUNCTION "executive_approval_immutable"();
