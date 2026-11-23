-- «Цалин» таб: сарын нийт дүнгийн ЗАДАРГАА (тэтгэмж, өвчний тэтгэмж, ТУЗ-ийн урамшуулал, суутгалууд). Зөвхөн байгууллагын нийт дүн: хүн, хэлтсийн мэдээлэл ЭНД ХАДГАЛАГДАХГҮЙ.
-- Additive only: nullable columns on onec_payroll_month, no data change. NULL = задаргаа хараахан татагдаагүй хуучин мөр (sync-ээр бөглөгдөнө).

-- AlterTable
ALTER TABLE "onec_payroll_month"
    ADD COLUMN "benefit" DECIMAL(18,2),
    ADD COLUMN "sick_pay" DECIMAL(18,2),
    ADD COLUMN "board" DECIMAL(18,2),
    ADD COLUMN "board_ndsh" DECIMAL(18,2),
    ADD COLUMN "board_hhoat" DECIMAL(18,2),
    ADD COLUMN "board_paid" DECIMAL(18,2),
    ADD COLUMN "other_deductions" DECIMAL(18,2);
