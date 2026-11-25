-- «Мөнгөн хөрөнгө» табын «Данснууд»: дансны нэр, нуух, дараалал (ADMIN). Additive only: шинэ хүснэгт, одоогийн өгөгдөлд хүрэхгүй.

-- CreateTable
CREATE TABLE "onec_cash_account_setting" (
    "key" TEXT NOT NULL,
    "display_name" TEXT NOT NULL DEFAULT '',
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER,
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "onec_cash_account_setting_pkey" PRIMARY KEY ("key")
);
