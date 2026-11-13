-- Manager price-review stage (between the branch approver and the finance director).
--
-- Additive only: two new RequestStatus values and one new ApprovalStepType value. No existing
-- column, row, constraint or index is touched.
--
-- Existing requests are NOT rewritten: one already past the branch approver keeps its current
-- steps and goes straight to finance as before; only requests created after this deploy get a
-- MANAGER_PRICING step (see app/api/requests/route.ts).
--
-- Note: ALTER TYPE ... ADD VALUE cannot be used by statements in the same transaction, and
-- nothing below uses the new values.

-- AlterEnum
ALTER TYPE "RequestStatus" ADD VALUE 'PENDING_MANAGER_PRICING';
ALTER TYPE "RequestStatus" ADD VALUE 'RETURNED_BY_MANAGER_PRICING';

-- AlterEnum
ALTER TYPE "ApprovalStepType" ADD VALUE 'MANAGER_PRICING';
