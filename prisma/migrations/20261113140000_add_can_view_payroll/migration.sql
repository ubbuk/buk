-- 1С OData хөтөч: цалингийн эрхийг хүн тус бүрээр олгох.
-- Additive only: one NOT NULL column with a constant default (existing users get false, no row is rewritten
-- beyond the default) and one new AuditAction value. Nothing existing is altered.
-- Note: ALTER TYPE ... ADD VALUE cannot be used by statements in the same transaction; nothing below uses it.

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'ONEC_PAYROLL_ACCESS';

-- AlterTable
ALTER TABLE "User" ADD COLUMN "canViewPayroll" BOOLEAN NOT NULL DEFAULT false;
