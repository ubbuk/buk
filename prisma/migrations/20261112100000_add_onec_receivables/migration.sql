-- CreateTable
CREATE TABLE "onec_receivables" (
    "id" BIGSERIAL NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "type" TEXT NOT NULL DEFAULT '',
    "client_code" TEXT NOT NULL DEFAULT '',
    "client" TEXT NOT NULL DEFAULT '',
    "doc" TEXT NOT NULL DEFAULT '',
    "doc_date" TEXT NOT NULL DEFAULT '',
    "due" TEXT NOT NULL DEFAULT '',
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "overdue_days" INTEGER NOT NULL DEFAULT 0,
    "synced_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onec_receivables_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "onec_receivables_snapshot_date_client_code_idx" ON "onec_receivables"("snapshot_date", "client_code");

