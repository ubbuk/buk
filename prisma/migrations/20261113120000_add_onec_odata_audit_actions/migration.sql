-- 1С OData хөтөч: хэн, хэзээ, ямар объект үзсэнийг AuditLog-д бүртгэх.
-- Additive only: two new AuditAction values. No existing column, row, constraint or index is touched.
-- Note: ALTER TYPE ... ADD VALUE cannot be used by statements in the same transaction; nothing below uses them.

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'ONEC_ODATA_VIEW';
ALTER TYPE "AuditAction" ADD VALUE 'ONEC_ODATA_DENIED';
