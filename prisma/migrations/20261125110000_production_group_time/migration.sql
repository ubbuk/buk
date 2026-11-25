-- «Үйлдвэрлэл» таб: цехийг эх хэлтэс (1С Parent) -ээр бүлэглэх, баримтын цаг. Additive only: default-той багана нэмнэ, өгөгдөл өөрчлөгдөхгүй.
-- Хоосон group_name = хараахан татагдаагүй хуучин мөр (sync дахин татахад бөглөгдөнө; хоосон бол цех өөрөө бүлэг).

-- AlterTable
ALTER TABLE "onec_production_line" ADD COLUMN "group_name" TEXT NOT NULL DEFAULT '',
ADD COLUMN "doc_time" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "onec_production_ledger" ADD COLUMN "group_name" TEXT NOT NULL DEFAULT '';
