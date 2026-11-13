-- 1С-ээс татах ажлыг нэг зэрэг ганцхан гүйцэтгэх түрээс (lib/onec/refresh.ts). Additive only: one new table.

-- CreateTable
CREATE TABLE "onec_sync_lock" (
    "name" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "locked_until" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "onec_sync_lock_pkey" PRIMARY KEY ("name")
);
