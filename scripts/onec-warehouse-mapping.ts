// 1С-ийн складуудыг (onec_stock) агуулахын бүтэцтэй (Warehouse) тулгах тайлан (ЗӨВХӨН УНШИХ, юу ч бичихгүй).
//   npm run onec:warehouse-mapping
// Mapping-ийг энэ скрипт ТААМАГЛАЖ БИЧИХГҮЙ: зөвхөн жагсаалт гаргана. Хүн баталсны дараа Warehouse.onecCode-г гараар бөглөнө.
// Тайлан:
//   1. таарсан: Warehouse.onecCode тэнцүү (баталсан mapping), эсвэл нормчилсон нэр тэнцүү 1С склад -> агуулах
//   2. хэсэгчлэн төстэй (нэг нь нөгөөгөө агуулсан): ГАРААР БАТЛАХ нэр дэвшигч, автоматаар холбохгүй
//   3. бүтцэд олдоогүй 1С склад
//   4. 1С-д олдоогүй агуулах (бүтцэд бий, 1С-д харгалзах склад алга)
//   5. давхардал: нэг код олон нэртэй, нэг нэр олон кодтой, эсвэл нэг агуулах руу олон склад таарсан
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** Үсэг, тооноос бусдыг хасч, жижиг үсэг, ё=е болгоно: "Ууганцэцэг (хангамж)" -> "ууганцэцэгхангамж". */
export const normalizeName = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, "");

interface OnecWarehouse {
  code: string;
  name: string;
  rows: number;
  lastSnapshot: string;
}
interface Wh {
  id: string;
  name: string;
  level: "дээд" | "байршил";
  onecCode: string | null;
  key: string;
}

export function classify(onec: OnecWarehouse[], warehouses: Wh[]) {
  const exact: { onec: OnecWarehouse; wh: Wh }[] = [];
  const partial: { onec: OnecWarehouse; wh: Wh }[] = [];
  const unmatched: OnecWarehouse[] = [];
  for (const o of onec) {
    const key = normalizeName(o.name);
    // a confirmed mapping (Warehouse.onecCode) wins; a blank 1С code never matches anything
    const byCode = o.code ? warehouses.filter((w) => w.onecCode === o.code) : [];
    const same = byCode.length > 0 ? byCode : key ? warehouses.filter((w) => w.key === key) : [];
    if (same.length > 0) {
      for (const wh of same) exact.push({ onec: o, wh });
      continue;
    }
    const near = key.length >= 4 ? warehouses.filter((w) => w.key.length >= 4 && (w.key.includes(key) || key.includes(w.key))) : [];
    if (near.length > 0) for (const wh of near) partial.push({ onec: o, wh });
    else unmatched.push(o);
  }
  const touched = new Set([...exact, ...partial].map((m) => m.wh.id));
  const missingInOnec = warehouses.filter((w) => !touched.has(w.id));

  const codesByName = new Map<string, Set<string>>();
  const namesByCode = new Map<string, Set<string>>();
  for (const o of onec) {
    const n = normalizeName(o.name);
    (codesByName.get(n) ?? codesByName.set(n, new Set()).get(n)!).add(o.code);
    (namesByCode.get(o.code) ?? namesByCode.set(o.code, new Set()).get(o.code)!).add(o.name);
  }
  const duplicates = {
    sameNameManyCodes: [...codesByName].filter(([, codes]) => codes.size > 1).map(([name, codes]) => ({ name, codes: [...codes] })),
    sameCodeManyNames: [...namesByCode].filter(([, names]) => names.size > 1).map(([code, names]) => ({ code, names: [...names] })),
    manyOnecOneWarehouse: [...new Set([...exact, ...partial].map((m) => m.wh.id))]
      .map((id) => ({ wh: warehouses.find((w) => w.id === id)!, onec: [...exact, ...partial].filter((m) => m.wh.id === id).map((m) => `${m.onec.code} «${m.onec.name}»`) }))
      .filter((x) => x.onec.length > 1),
  };
  return { exact, partial, unmatched, missingInOnec, duplicates };
}

async function main() {
  const onec = (
    await prisma.$queryRaw<{ code: string; name: string; rows: bigint; last: Date }[]>`
      SELECT warehouse_code AS code, warehouse AS name, count(*)::bigint AS rows, max(snapshot_date) AS last
      FROM onec_stock GROUP BY warehouse_code, warehouse ORDER BY warehouse, warehouse_code`
  ).map((r) => ({ code: r.code, name: r.name, rows: Number(r.rows), lastSnapshot: r.last.toISOString().slice(0, 10) }));
  const rows = await prisma.warehouse.findMany({ where: { isActive: true }, orderBy: [{ parentId: "asc" }, { name: "asc" }] });
  // the keeper groups (top level, with children) are not 1С warehouses: only the warehouses that can carry a 1С code are compared
  const parents = new Set(rows.map((w) => w.parentId).filter((id): id is string => !!id));
  const warehouses: Wh[] = rows.filter((w) => !parents.has(w.id)).map((w) => ({ id: w.id, name: w.name, level: w.parentId ? "байршил" : "дээд", onecCode: w.onecCode, key: normalizeName(w.name) }));

  console.log(`\n1С складын тоо (onec_stock): ${onec.length} · агуулахын бүтэц: ${warehouses.length} мөр\n`);
  if (onec.length === 0) {
    console.log("onec_stock хоосон: эхлээд `npm run sync:1c` ажиллуулсан эсэхийг шалгана уу. Тулгах зүйл алга.");
    return;
  }
  const r = classify(onec, warehouses);
  const show = (title: string, data: unknown[]) => {
    console.log(`\n== ${title} (${data.length}) ==`);
    if (data.length) console.table(data);
  };
  show("1. Таарсан (код эсвэл нэрээр)", r.exact.map((m) => ({ "1С код": m.onec.code, "1С склад": m.onec.name, "Агуулах": m.wh.name, түвшин: m.wh.level, "одоогийн onecCode": m.wh.onecCode ?? "", мөр: m.onec.rows })));
  show("2. Хэсэгчлэн төстэй (ГАРААР БАТЛАХ, автоматаар холбоогүй)", r.partial.map((m) => ({ "1С код": m.onec.code, "1С склад": m.onec.name, "Нэр дэвшигч агуулах": m.wh.name, түвшин: m.wh.level })));
  show("3. Бүтцэд олдоогүй 1С склад", r.unmatched.map((o) => ({ код: o.code, склад: o.name, мөр: o.rows, "сүүлийн snapshot": o.lastSnapshot })));
  show("4. 1С-д олдоогүй агуулах", r.missingInOnec.map((w) => ({ агуулах: w.name, түвшин: w.level, "одоогийн onecCode": w.onecCode ?? "" })));
  show("5a. Нэг нэр олон кодтой", r.duplicates.sameNameManyCodes);
  show("5b. Нэг код олон нэртэй", r.duplicates.sameCodeManyNames);
  show("5c. Нэг агуулах руу олон 1С склад таарсан", r.duplicates.manyOnecOneWarehouse.map((d) => ({ агуулах: d.wh.name, "1С складууд": d.onec.join("; ") })));
  console.log("\nЭнэ тайлан юу ч өөрчлөөгүй. Баталсан mapping-ийг танаас авсны дараа Warehouse.onecCode-г бөглөнө.");
}

// the pure parts above are imported by the test; only run the database report when executed directly
if (process.argv[1] && /onec-warehouse-mapping\.ts$/.test(process.argv[1].replace(/\\/g, "/"))) {
  main()
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
