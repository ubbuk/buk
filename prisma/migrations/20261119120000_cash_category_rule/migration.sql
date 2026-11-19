-- «Мөнгөн хөрөнгө» таб: банкны гүйлгээг ердийн ангилалд (Борлуулалтын орлого, Нийлүүлэгчид, Цалин ...) хуваах, АДМИНЫ засдаг дүрмүүд.
-- Код доторх анхдагч дүрмүүдээс ӨМНӨ үнэлэгдэнэ (priority өсөхөөр). Зөвхөн дүрэм: гүйлгээ, хүн, нууц мэдээлэл ЭНД ХАДГАЛАГДАХГҮЙ.
-- Additive only: one new table, no change to existing tables.

-- CreateTable
CREATE TABLE "onec_cash_category_rule" (
    "id" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'ANY',
    "field" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "onec_cash_category_rule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "onec_cash_category_rule_is_active_priority_idx" ON "onec_cash_category_rule"("is_active", "priority");
