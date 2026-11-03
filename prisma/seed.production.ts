import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

// Minimal, demo-free seed for a real deployment (see DEPLOY.md).
//
// Creates ONLY what the app cannot be set up without:
//   * one ADMIN account (everything else -- departments, users, approver positions,
//     department heads -- is then created by that admin in the /admin page),
//   * one empty central warehouse row (stock levels are tracked against it).
// No demo users, no demo materials, no shared demo password.
//
//   SEED_PASSWORD   required, at least 12 characters (no default on purpose)
//   ADMIN_EMAIL     optional, default admin@ubbuk.mn
//   ADMIN_NAME      optional, default "Системийн админ"
//
// Safe to re-run: it upserts, and re-running with a new SEED_PASSWORD resets the
// admin's password.
const prisma = new PrismaClient();

async function main() {
  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error("Set SEED_PASSWORD to the admin password (at least 12 characters) before running this seed.");
  }
  const email = (process.env.ADMIN_EMAIL ?? "admin@ubbuk.mn").trim().toLowerCase();
  const name = process.env.ADMIN_NAME ?? "Системийн админ";
  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.user.upsert({
    where: { email },
    update: { name, role: "ADMIN", isActive: true, passwordHash },
    create: { email, name, role: "ADMIN", title: "Системийн админ", passwordHash },
  });

  await prisma.warehouse.upsert({
    where: { id: "w-central" },
    update: {},
    create: { id: "w-central", name: "Төв агуулах" },
  });

  console.log(`Production seed complete. Admin account: ${email}`);
  console.log("Next: sign in, then create departments, users, approver positions and department heads in /admin.");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
