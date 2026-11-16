import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

type Db = Prisma.TransactionClient | typeof prisma;

// Who gets the request at step 2 (warehouse check):
//   PRIMARY       every request goes to the primary keeper (the STOREKEEPER_LEAD position). The default.
//   BY_WAREHOUSE  the keeper of the warehouse that holds the requested materials; a warehouse without a keeper
//                 falls back to the primary keeper (see lib/warehouse-keeper.ts).
// The keeper's decision is final in both modes: there is no senior-keeper step.
export const KEEPER_MODES = ["PRIMARY", "BY_WAREHOUSE"] as const;
export type KeeperMode = (typeof KEEPER_MODES)[number];
export const DEFAULT_KEEPER_MODE: KeeperMode = "PRIMARY";
export const KEEPER_MODE_KEY = "step2_keeper_mode";

export function isKeeperMode(value: unknown): value is KeeperMode {
  return typeof value === "string" && (KEEPER_MODES as readonly string[]).includes(value);
}

/** An unknown or missing value reads as the default, so a bad row can never route requests somewhere unexpected. */
export async function getKeeperMode(db: Db = prisma): Promise<KeeperMode> {
  const row = await db.systemSetting.findUnique({ where: { key: KEEPER_MODE_KEY } });
  return isKeeperMode(row?.value) ? row.value : DEFAULT_KEEPER_MODE;
}

export async function setKeeperMode(db: Db, mode: KeeperMode, actorId: string): Promise<{ before: KeeperMode; changed: boolean }> {
  const before = await getKeeperMode(db);
  if (before === mode) return { before, changed: false };
  await db.systemSetting.upsert({
    where: { key: KEEPER_MODE_KEY },
    update: { value: mode, updatedById: actorId },
    create: { key: KEEPER_MODE_KEY, value: mode, updatedById: actorId },
  });
  await db.auditLog.create({
    data: {
      entityType: "SystemSetting",
      entityId: KEEPER_MODE_KEY,
      action: "UPDATE",
      actorId,
      beforeJson: JSON.stringify({ mode: before }),
      afterJson: JSON.stringify({ mode }),
    },
  });
  return { before, changed: true };
}
