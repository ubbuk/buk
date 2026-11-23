-- Admin user removal: an account with history (audit log, decided approvals ...) cannot be hard-deleted, so it is marked deleted instead.
-- Additive only: one nullable column on "User", no data change.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);
