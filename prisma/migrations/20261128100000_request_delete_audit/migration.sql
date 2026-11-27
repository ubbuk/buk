-- Захиалга устгах: аудитын шинэ төрөл. Additive only (enum-д нэг утга нэмнэ), одоо байгаа өгөгдөлд хүрэхгүй.
-- Note: ALTER TYPE ... ADD VALUE cannot be used by statements in the same transaction; nothing below uses it.

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'REQUEST_DELETE';
