-- «Цалин» таб: байгууллагын цалингийн САРЫН НИЙТ дүн (sync-ээр бөглөнө). Зөвхөн нийт дүн: хүн, хэлтсийн мэдээлэл ЭНД ХАДГАЛАГДАХГҮЙ
-- (хүний түвшин, хэлтсээр нь «Цалин» таб нээх бүрд 1С-ээс шууд уншигдана).
-- Additive only: one new table, no change to existing tables.

-- CreateTable
CREATE TABLE "onec_payroll_month" (
    "id" BIGSERIAL NOT NULL,
    "month" TEXT NOT NULL,
    "accrued" DECIMAL(18,2) NOT NULL,
    "employer_ndsh" DECIMAL(18,2) NOT NULL,
    "employee_ndsh" DECIMAL(18,2) NOT NULL,
    "hhoat" DECIMAL(18,2) NOT NULL,
    "paid_bank" DECIMAL(18,2) NOT NULL,
    "paid_cash" DECIMAL(18,2) NOT NULL,
    "closing_payable" DECIMAL(18,2) NOT NULL,
    "lines" INTEGER NOT NULL DEFAULT 0,
    "synced_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "onec_payroll_month_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "onec_payroll_month_month_key" ON "onec_payroll_month"("month");
