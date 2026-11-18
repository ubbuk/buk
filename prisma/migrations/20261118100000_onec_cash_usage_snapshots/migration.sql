-- Мониторингийн «1С · Санхүүгийн тойм»-д мөнгөн хөрөнгө, зарцуулалтыг 1С руу хандахгүйгээр харуулах агшин зургууд (sync-ээр бөглөнө).
-- Additive only: two new tables, no change to existing tables.
-- onec_cash_balance: өдрийн эцсийн мөнгөний дансны (10xx, 11xx) үлдэгдэл данс бүрээр.
-- onec_usage_month: сарын нийт зарцуулалт (ТребованиеНакладная), сар бүрт нэг мөр.

-- CreateTable
CREATE TABLE "onec_cash_balance" (
    "id" BIGSERIAL NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "account_code" TEXT NOT NULL,
    "account_name" TEXT NOT NULL DEFAULT '',
    "balance" DECIMAL(18,2) NOT NULL,
    "synced_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "onec_cash_balance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onec_usage_month" (
    "id" BIGSERIAL NOT NULL,
    "month" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "documents" INTEGER NOT NULL DEFAULT 0,
    "synced_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "onec_usage_month_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "onec_cash_balance_snapshot_date_account_code_idx" ON "onec_cash_balance"("snapshot_date", "account_code");

-- CreateIndex
CREATE UNIQUE INDEX "onec_usage_month_month_key" ON "onec_usage_month"("month");
