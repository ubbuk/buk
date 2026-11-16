import { PrismaClient } from "@prisma/client";
import { seedWarehouseStructure } from "./warehouse-structure";

// Seeds ONLY the warehouse structure (1С warehouses grouped under their keeper groups, the keeper mode setting).
// Unlike seed.production.ts it needs no SEED_PASSWORD and never touches users: use it on an existing production
// database (DEPLOY.md). Idempotent; it keeps existing rows, stock, keepers and priorities, and removes the earlier
// invented locations only when nothing refers to them. Keepers are assigned afterwards in /admin.
const prisma = new PrismaClient();

async function main() {
  const result = await seedWarehouseStructure(prisma);
  const [warehouses, mapped] = await Promise.all([prisma.warehouse.count(), prisma.warehouse.count({ where: { onecCode: { not: null } } })]);
  console.log(`Warehouse structure seeded: ${warehouses} warehouses, ${mapped} mapped to 1С.`);
  if (result.removed.length) console.log(`Removed obsolete warehouses: ${result.removed.join(", ")}`);
  if (result.kept.length) console.log(`Obsolete warehouses kept (they still hold stock/reservations): ${result.kept.join(", ")}`);
  console.log("Next: assign the keepers in /admin (Агуулах, нярав).");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
