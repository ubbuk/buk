-- CreateTable
CREATE TABLE "onec_sales" (
    "id" BIGSERIAL NOT NULL,
    "date" DATE NOT NULL,
    "org" TEXT NOT NULL DEFAULT '',
    "item_code" TEXT NOT NULL DEFAULT '',
    "item" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT '',
    "qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "vat" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "cost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "client_code" TEXT NOT NULL DEFAULT '',
    "client" TEXT NOT NULL DEFAULT '',
    "client_reg" TEXT NOT NULL DEFAULT '',
    "dept" TEXT NOT NULL DEFAULT '',
    "doc" TEXT NOT NULL DEFAULT '',
    "row_type" TEXT NOT NULL DEFAULT '',
    "synced_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onec_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onec_pl" (
    "id" BIGSERIAL NOT NULL,
    "month" CHAR(7) NOT NULL,
    "item_code" TEXT NOT NULL DEFAULT '',
    "item" TEXT NOT NULL DEFAULT '',
    "account" TEXT NOT NULL DEFAULT '',
    "account_group" TEXT NOT NULL DEFAULT '',
    "side" TEXT NOT NULL DEFAULT '',
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "synced_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onec_pl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onec_stock" (
    "id" BIGSERIAL NOT NULL,
    "snapshot_date" DATE NOT NULL,
    "org" TEXT NOT NULL DEFAULT '',
    "warehouse_code" TEXT NOT NULL DEFAULT '',
    "warehouse" TEXT NOT NULL DEFAULT '',
    "item_code" TEXT NOT NULL DEFAULT '',
    "item" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT '',
    "account" TEXT NOT NULL DEFAULT '',
    "qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "synced_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onec_stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onec_cash" (
    "id" BIGSERIAL NOT NULL,
    "date" DATE NOT NULL,
    "account" TEXT NOT NULL DEFAULT '',
    "client_code" TEXT NOT NULL DEFAULT '',
    "client" TEXT NOT NULL DEFAULT '',
    "item_code" TEXT NOT NULL DEFAULT '',
    "item" TEXT NOT NULL DEFAULT '',
    "inflow" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "outflow" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "memo" TEXT NOT NULL DEFAULT '',
    "doc" TEXT NOT NULL DEFAULT '',
    "synced_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onec_cash_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onec_sync_log" (
    "id" BIGSERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "rows" INTEGER NOT NULL DEFAULT 0,
    "ok" BOOLEAN NOT NULL,
    "message" TEXT,
    "started_at" TIMESTAMPTZ NOT NULL,
    "finished_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onec_sync_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "onec_sales_date_idx" ON "onec_sales"("date");

-- CreateIndex
CREATE INDEX "onec_sales_item_code_date_idx" ON "onec_sales"("item_code", "date");

-- CreateIndex
CREATE INDEX "onec_sales_client_code_date_idx" ON "onec_sales"("client_code", "date");

-- CreateIndex
CREATE INDEX "onec_pl_month_account_group_idx" ON "onec_pl"("month", "account_group");

-- CreateIndex
CREATE INDEX "onec_stock_snapshot_date_warehouse_code_idx" ON "onec_stock"("snapshot_date", "warehouse_code");

-- CreateIndex
CREATE INDEX "onec_stock_item_code_snapshot_date_idx" ON "onec_stock"("item_code", "snapshot_date");

-- CreateIndex
CREATE INDEX "onec_cash_date_idx" ON "onec_cash"("date");

-- CreateIndex
CREATE INDEX "onec_cash_account_date_idx" ON "onec_cash"("account", "date");

-- CreateIndex
CREATE INDEX "onec_sync_log_kind_finished_at_idx" ON "onec_sync_log"("kind", "finished_at" DESC);

