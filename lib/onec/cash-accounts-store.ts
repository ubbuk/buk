// «Мөнгөн хөрөнгө» табын дансны нэр, нуух, дараалал (ADMIN-ы тохиргоо). Зөвхөн харагдац: үлдэгдэл, гүйлгээ өөрчлөгдөхгүй.
import { prisma } from "@/lib/prisma";
import type { AccountSetting } from "./cash-accounts";

export const MAX_NAME = 60;

/** Бүх дансны тохиргоо: түлхүүр -> тохиргоо */
export async function loadAccountSettings(): Promise<Map<string, AccountSetting>> {
  const rows = await prisma.onecCashAccountSetting.findMany();
  return new Map(rows.map((r) => [r.key, { key: r.key, name: r.displayName, hidden: r.hidden, sortOrder: r.sortOrder }]));
}

export interface AccountSettingInput {
  key: string;
  name: string;
  hidden: boolean;
  sortOrder: number | null;
}

/** Тохиргоог хадгална: нэргүй, нуугаагүй, дараалалгүй мөрийг устгана (анхдагч руу буцна). Нэг transaction. */
export async function saveAccountSettings(items: readonly AccountSettingInput[], actorId: string): Promise<{ saved: number; removed: number }> {
  let saved = 0;
  let removed = 0;
  await prisma.$transaction(async (tx) => {
    for (const it of items) {
      const name = it.name.trim().slice(0, MAX_NAME);
      if (!name && !it.hidden && it.sortOrder === null) {
        const r = await tx.onecCashAccountSetting.deleteMany({ where: { key: it.key } });
        removed += r.count;
        continue;
      }
      await tx.onecCashAccountSetting.upsert({
        where: { key: it.key },
        create: { key: it.key, displayName: name, hidden: it.hidden, sortOrder: it.sortOrder, updatedById: actorId },
        update: { displayName: name, hidden: it.hidden, sortOrder: it.sortOrder, updatedById: actorId },
      });
      saved++;
    }
    await tx.auditLog.create({ data: { entityType: "CashAccountSetting", entityId: "all", action: "UPDATE", actorId, afterJson: JSON.stringify({ saved, removed }) } });
  });
  return { saved, removed };
}
