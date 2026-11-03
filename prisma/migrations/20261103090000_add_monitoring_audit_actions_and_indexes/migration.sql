-- Additive only: two new AuditAction values and four secondary indexes used by
-- /admin/monitoring. No existing column, row or constraint is touched, so it is
-- safe to apply to a database that already holds data (and backwards compatible
-- with the previous application version).
--
-- Note: ALTER TYPE ... ADD VALUE cannot be used by statements in the same
-- transaction, and nothing below uses the new values.
-- The CREATE INDEX statements take a brief write lock on AuditLog / ApprovalAction;
-- both tables are small (tens-hundreds of rows today). For a much larger table,
-- create them with CREATE INDEX CONCURRENTLY outside a migration instead.

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'VIEW_MONITORING';
ALTER TYPE "AuditAction" ADD VALUE 'MONITORING_ACCESS_DENIED';

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "ApprovalAction_createdAt_idx" ON "ApprovalAction"("createdAt");
