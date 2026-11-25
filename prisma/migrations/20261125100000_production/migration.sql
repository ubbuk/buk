-- «Үйлдвэрлэл» таб: 1С-ийн ОтчетПроизводстваЗаСмену баримтын гарц ба нягтлангийн бичилтийн агшин зураг.
-- Additive only: хоёр шинэ хүснэгт, одоо байгаа өгөгдөлд өөрчлөлт байхгүй. Хүний мэдээлэл хадгалахгүй.

-- CreateTable
CREATE TABLE "onec_production_line" (
    "id" BIGSERIAL NOT NULL,
    "month" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "doc_ref" TEXT NOT NULL,
    "doc_number" TEXT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "posted" BOOLEAN NOT NULL,
    "stage" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "product_key" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "synced_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onec_production_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onec_production_ledger" (
    "id" BIGSERIAL NOT NULL,
    "month" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "product_key" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "synced_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onec_production_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "onec_production_line_doc_ref_line_no_key" ON "onec_production_line"("doc_ref", "line_no");

-- CreateIndex
CREATE INDEX "onec_production_line_month_day_idx" ON "onec_production_line"("month", "day");

-- CreateIndex
CREATE INDEX "onec_production_ledger_month_idx" ON "onec_production_ledger"("month");
