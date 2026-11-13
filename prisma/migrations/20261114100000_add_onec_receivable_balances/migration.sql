-- «Авлага» табын агшин зураг (1С OData Balance, ~10-110 сек): нээхэд Postgres-ээс шууд, ар талд шинэчлэгдэнэ (lib/onec/receivables-store.ts).
-- Additive only: one new table. 1201 нь харилцагч бүрээр, НӨАТ-ын данс (1271, 1272) нэг нэгтгэсэн мөрөөр.

-- CreateTable
CREATE TABLE "onec_receivable_balances" (
    "id" BIGSERIAL NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "account_code" TEXT NOT NULL,
    "account_name" TEXT NOT NULL DEFAULT '',
    "customer_key" TEXT NOT NULL DEFAULT '',
    "customer" TEXT NOT NULL DEFAULT '',
    "balance" DECIMAL(18,2) NOT NULL,
    "customers" INTEGER NOT NULL DEFAULT 1,
    "synced_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "onec_receivable_balances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "onec_receivable_balances_snapshot_date_account_code_idx" ON "onec_receivable_balances"("snapshot_date", "account_code");
