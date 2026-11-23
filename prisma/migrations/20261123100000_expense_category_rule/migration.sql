-- «Зардал» таб: зардлыг ердийн ангилалд (Түрээс, Тээвэр, Цахилгаан ...) хуваах, АДМИНЫ засдаг дүрмүүд.
-- Код доторх анхдагч дүрмүүдээс ӨМНӨ үнэлэгдэнэ (priority өсөхөөр). Зөвхөн дүрэм: дүн, хүн, нууц мэдээлэл ЭНД ХАДГАЛАГДАХГҮЙ.
-- Additive only: one new table, no change to existing tables.

-- CreateTable
CREATE TABLE "onec_expense_category_rule" (
    "id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "onec_expense_category_rule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "onec_expense_category_rule_is_active_priority_idx" ON "onec_expense_category_rule"("is_active", "priority");
