-- Session revocation (Stage 2): additive. A constant DEFAULT is a metadata-only change on PostgreSQL 11+, no table rewrite.
-- Existing sessions carry no version and are read as version 0, which every existing row has: nobody is signed out by this migration.
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "passwordChangedAt" TIMESTAMP(3),
ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 0;
