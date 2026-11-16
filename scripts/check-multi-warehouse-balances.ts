// Нэг материал хэд хэдэн агуулахад үлдэгдэлтэй (InventoryBalance мөртэй) эсэхийг шалгана (ЗӨВХӨН УНШИХ).
//   npm run check:multi-warehouse
// Нөөцлөлтийн хуучин код материал тус бүрээс ЗӨВХӨН ХАМГИЙН СҮҮЛИЙН мөрийг авдаг байсан: олон мөртэй материал дээр
// тэр нь санамсаргүй агуулахыг сонгож, бусдын үлдэгдлийг үл тоодог байв. Энэ скрипт тийм материал одоо байгааг харуулна.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.inventoryBalance.findMany({
    include: { material: { select: { code: true, name: true } }, warehouse: { select: { name: true, isActive: true } } },
    orderBy: [{ materialId: "asc" }, { warehouseId: "asc" }],
  });
  const byMaterial = new Map<string, typeof rows>();
  for (const r of rows) (byMaterial.get(r.materialId) ?? byMaterial.set(r.materialId, []).get(r.materialId)!).push(r);
  const multi = [...byMaterial.values()].filter((list) => list.length > 1);

  console.log(`\nInventoryBalance мөр: ${rows.length} · материал: ${byMaterial.size} · олон агуулахад мөртэй материал: ${multi.length}`);
  const [reserved, openReservations] = await Promise.all([
    prisma.inventoryBalance.count({ where: { quantityReserved: { gt: 0 } } }),
    prisma.stockReservation.count({ where: { status: "RESERVED" } }),
  ]);
  console.log(`quantityReserved > 0 байгаа мөр: ${reserved} · RESERVED төлөвтэй нөөцлөлт: ${openReservations}`);
  if (multi.length === 0) {
    console.log("\nОлон агуулахад мөртэй материал олдсонгүй: хуучин «сүүлийн мөр» алдаа энэ баазад өгөгдөлд нөлөөлөөгүй.");
    return;
  }
  console.table(
    multi.flatMap((list) =>
      list.map((r) => ({ материал: `${r.material.code} ${r.material.name}`, агуулах: r.warehouse.name, идэвхтэй: r.warehouse.isActive, үлдэгдэл: Number(r.quantityOnHand), нөөцөлсөн: Number(r.quantityReserved) }))
    )
  );
  // Where the old code could have reserved from the wrong place: requests that already took stock of these materials.
  const ids = multi.map((l) => l[0].materialId);
  const issued = await prisma.stockReservation.count({ where: { requestItem: { materialId: { in: ids } } } });
  console.log(`\nЭдгээр материалаас олгосон (StockReservation) бичилт: ${issued}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
