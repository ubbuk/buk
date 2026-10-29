import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DEMO_PASSWORD = "ubbuk2026";

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // --- Departments (head assigned after users exist — circular FK) -------
  const departmentDefs = [
    { id: "d-concrete", name: "Бетон цех", type: "FACTORY" as const },
    { id: "d-metal", name: "Металл хийцийн цех", type: "FACTORY" as const },
    { id: "d-mechanic", name: "Механик засвар", type: "FACTORY" as const },
    { id: "d-finance", name: "Санхүү, аж ахуй", type: "OFFICE" as const },
    { id: "d-admin", name: "Удирдлага, захиргаа", type: "OFFICE" as const },
  ];
  for (const d of departmentDefs) {
    await prisma.department.upsert({
      where: { id: d.id },
      update: { name: d.name, type: d.type },
      create: { id: d.id, name: d.name, type: d.type },
    });
  }

  // --- Users ---------------------------------------------------------------
  const userDefs = [
    { id: "u-tumurbaatar", email: "tumurbaatar@ubbuk.mn", name: "Б.Төмөрбаатар", role: "EMPLOYEE" as const, departmentId: "d-concrete" },
    { id: "u-bold", email: "bold@ubbuk.mn", name: "Ц.Болд", role: "DEPARTMENT_HEAD" as const, departmentId: "d-concrete" },
    { id: "u-purev", email: "purev@ubbuk.mn", name: "Д.Пүрэв", role: "DEPARTMENT_HEAD" as const, departmentId: "d-metal" },
    { id: "u-erdene", email: "erdene@ubbuk.mn", name: "Н.Эрдэнэ", role: "DEPARTMENT_HEAD" as const, departmentId: "d-mechanic" },
    { id: "u-munkhzul", email: "munkhzul@ubbuk.mn", name: "О.Мөнхзул", role: "DEPARTMENT_HEAD" as const, departmentId: "d-finance" },
    { id: "u-ariunaa", email: "ariunaa@ubbuk.mn", name: "Б.Ариунаа", role: "DEPARTMENT_HEAD" as const, departmentId: "d-admin" },
    { id: "u-sarnai", email: "sarnai@ubbuk.mn", name: "Г.Сарнай", role: "WAREHOUSE_CLERK" as const, departmentId: null },
    { id: "u-khuntsengel", email: "khuntsengel@ubbuk.mn", name: "Н.Хүнцэнгэл", role: "OFFICE_APPROVER" as const, departmentId: null },
    { id: "u-narmandakh", email: "narmandakh@ubbuk.mn", name: "Б.Нармандах", role: "FACTORY_APPROVER" as const, departmentId: null },
    { id: "u-magomed", email: "magomed@ubbuk.mn", name: "Хамхоев Магомед", role: "DIRECTOR" as const, departmentId: null },
    { id: "u-procurement", email: "procurement@ubbuk.mn", name: "О.Пүрэвсүрэн", role: "PROCUREMENT_OFFICER" as const, departmentId: null },
  ];
  for (const u of userDefs) {
    await prisma.user.upsert({
      where: { id: u.id },
      update: { email: u.email, name: u.name, role: u.role, departmentId: u.departmentId, passwordHash },
      create: { id: u.id, email: u.email, name: u.name, role: u.role, departmentId: u.departmentId, passwordHash },
    });
  }

  // --- Wire department heads now that the users exist ---------------------
  await prisma.department.update({ where: { id: "d-concrete" }, data: { headId: "u-bold" } });
  await prisma.department.update({ where: { id: "d-metal" }, data: { headId: "u-purev" } });
  await prisma.department.update({ where: { id: "d-mechanic" }, data: { headId: "u-erdene" } });
  await prisma.department.update({ where: { id: "d-finance" }, data: { headId: "u-munkhzul" } });
  await prisma.department.update({ where: { id: "d-admin" }, data: { headId: "u-ariunaa" } });

  // --- Org-wide approval role assignments ----------------------------------
  const approvalRoles: { role: "OFFICE_APPROVER" | "FACTORY_APPROVER" | "DIRECTOR"; userId: string }[] = [
    { role: "OFFICE_APPROVER", userId: "u-khuntsengel" },
    { role: "FACTORY_APPROVER", userId: "u-narmandakh" },
    { role: "DIRECTOR", userId: "u-magomed" },
  ];
  for (const a of approvalRoles) {
    const existing = await prisma.approvalRoleAssignment.findFirst({ where: { role: a.role, isActive: true } });
    if (!existing) {
      await prisma.approvalRoleAssignment.create({ data: { role: a.role, userId: a.userId, isActive: true } });
    }
  }

  // --- Warehouse + materials + stock ---------------------------------------
  const warehouse = await prisma.warehouse.upsert({
    where: { id: "w-central" },
    update: { name: "Төв агуулах" },
    create: { id: "w-central", name: "Төв агуулах", location: "Үйлдвэрийн талбай" },
  });

  // Mechanical/industrial spare parts — not construction materials, per spec.
  const materialDefs = [
    { id: "m-brg6205", code: "BRG-6205", name: "Подшипник 6205", unit: "ш", price: 45000, balance: 4 },
    { id: "m-brg6305", code: "BRG-6305", name: "Подшипник 6305", unit: "ш", price: 52000, balance: 15 },
    { id: "m-hydoil", code: "HYD-46", name: "Гидравлик тос HLP-46", unit: "л", price: 12500, balance: 80 },
    { id: "m-oilflt", code: "FLT-OIL1", name: "Тосны шүүлтүүр", unit: "ш", price: 28000, balance: 6 },
    { id: "m-vbelt", code: "BLT-A1200", name: "Клинэн бүс А-1200", unit: "ш", price: 38000, balance: 10 },
    { id: "m-weldrod", code: "WLD-ROD", name: "Гагнуурын электрод", unit: "кг", price: 12500, balance: 64 },
    { id: "m-co2", code: "GLV-BND", name: "Гагнуурын баллон (CO2)", unit: "ш", price: 185000, balance: 2 },
    { id: "m-wire", code: "WIRE-1.2", name: "Холбох утас ∅1.2", unit: "кг", price: 6200, balance: 210 },
    { id: "m-circlip", code: "CLP-STD", name: "Тэнхлэгийн цагираг", unit: "ш", price: 3500, balance: 40 },
    { id: "m-convbelt", code: "CNV-BLT", name: "Конвейерын бүс", unit: "м", price: 56000, balance: 25 },
  ];
  for (const m of materialDefs) {
    await prisma.material.upsert({
      where: { id: m.id },
      update: { code: m.code, name: m.name, unit: m.unit, defaultPrice: m.price },
      create: { id: m.id, code: m.code, name: m.name, unit: m.unit, defaultPrice: m.price },
    });
    await prisma.inventoryBalance.upsert({
      where: { materialId_warehouseId: { materialId: m.id, warehouseId: warehouse.id } },
      update: { quantityOnHand: m.balance },
      create: { materialId: m.id, warehouseId: warehouse.id, quantityOnHand: m.balance },
    });
  }

  console.log("Seed complete.");
  console.log(`All demo users share the password: ${DEMO_PASSWORD}`);
  console.log(userDefs.map((u) => `  ${u.email}  (${u.role})`).join("\n"));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
