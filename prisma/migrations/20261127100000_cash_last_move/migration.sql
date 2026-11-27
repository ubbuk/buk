-- «Мөнгөн хөрөнгө» табын «Хөдөлгөөнгүй данс»: данс бүрийн сар бүрийн сүүлийн бодит гүйлгээ (sync-ээр бичигдэнэ, хуудас зөвхөн уншина). Additive only: шинэ хүснэгт, одоогийн өгөгдөлд хүрэхгүй.

-- CreateTable
CREATE TABLE "onec_cash_last_move" (
    "key" TEXT NOT NULL,
    "month" CHAR(7) NOT NULL,
    "last_date" CHAR(10) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "synced_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onec_cash_last_move_pkey" PRIMARY KEY ("key","month")
);

-- CreateIndex
CREATE INDEX "onec_cash_last_move_month_idx" ON "onec_cash_last_move"("month");
