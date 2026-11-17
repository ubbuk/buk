import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { addDays, isDate, ubDate } from "./dates";

// onec_stock (1С-ийн үлдэгдлийн snapshot) → Material + InventoryBalance. `npm run sync:1c -- import-materials`, sync-1c.yml (mode=import-materials).
//
// Дүрэм (WAREHOUSE_CHECK алхам үлдэгдлийг InventoryBalance-аас уншдаг тул хоосон бол бүх мөр «дутуу» болно):
//   - Material-ийг 1С-ийн барааны кодоор (item_code = Material.code) холбоно. Байгаа Material-ийг ХЭЗЭЭ Ч өөрчлөхгүй, зөвхөн дутууг нэмнэ.
//   - Зөвхөн Warehouse.onecCode-той (идэвхтэй) агуулах дээрх үлдэгдлийг оруулна. Бусад 1С склад (кодгүй, давхар код) алгасагдаж, тайланд жагсаагдана.
//   - Нэг барааны нэг складын нийт үлдэгдэл = данс бүрийн qty-ийн нийлбэр. Зөвхөн qty > 0 мөр орно (тэг, сөрөг үлдэгдэл оруулахгүй).
//   - НЭГ УДАА ачаалах горим: ERP-д аль хэдийн байгаа InventoryBalance-ийг ДАРАХГҮЙ (олгосон, нөөцөлсөн хасалтыг алдахгүйн тулд). Зөвхөн
//     `refreshBalances` өгөхөд quantityOnHand-ийг snapshot-оор шинэчилнэ, тэгэхдээ нөөцлөгдсөн хэмжээнээс бага болох мөрийг алгасна.
//   - Анхдагч нь DRY-RUN (юу ч бичихгүй). Зөвхөн `apply: true`.

export interface ImportOptions {
  apply?: boolean;
  /** Snapshot-ын огноо (YYYY-MM-DD). Өгөхгүй бол хамгийн сүүлийнх, тэгэхдээ apply үед 2 хоногоос хуучин бол татгалзана */
  date?: string;
  refreshBalances?: boolean;
}

export interface ImportReport {
  apply: boolean;
  refreshBalances: boolean;
  snapshot: string | null;
  /** Snapshot-ын item × склад мөрийн тоо (данс нэгтгэсний дараа) */
  stockRows: number;
  mappedWarehouses: number;
  ambiguousCodes: string[];
  unmapped: { code: string; name: string; items: number }[];
  skipped: { noItemCode: number; unmappedWarehouse: number; ambiguousWarehouse: number; nonPositive: number; tooLarge: number };
  materials: { existing: number; toCreate: number; emptyUnit: number };
  balances: { toCreate: number; existingKept: number; toRefresh: number; refreshBlocked: number };
  created: { materials: number; balances: number; refreshed: number };
  sample: { code: string; name: string; unit: string; price: string }[];
}

const MAX_QTY = new Prisma.Decimal("99999999999.999"); // Decimal(14,3)
const CHUNK = 1000;
const chunks = <T>(a: T[], n = CHUNK): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));

interface Cand {
  code: string;
  warehouseId: string;
  qty: Prisma.Decimal;
  amount: Prisma.Decimal;
}

export async function importMaterials(opts: ImportOptions = {}): Promise<ImportReport> {
  const apply = opts.apply === true;
  const refreshBalances = opts.refreshBalances === true;
  const report: ImportReport = {
    apply,
    refreshBalances,
    snapshot: null,
    stockRows: 0,
    mappedWarehouses: 0,
    ambiguousCodes: [],
    unmapped: [],
    skipped: { noItemCode: 0, unmappedWarehouse: 0, ambiguousWarehouse: 0, nonPositive: 0, tooLarge: 0 },
    materials: { existing: 0, toCreate: 0, emptyUnit: 0 },
    balances: { toCreate: 0, existingKept: 0, toRefresh: 0, refreshBlocked: 0 },
    created: { materials: 0, balances: 0, refreshed: 0 },
    sample: [],
  };

  if (opts.date !== undefined && !isDate(opts.date)) throw new Error("date нь YYYY-MM-DD хэлбэртэй байх ёстой");
  const snapshot = opts.date ?? (await prisma.$queryRaw<{ d: string | null }[]>`SELECT max(snapshot_date)::text AS d FROM onec_stock`)[0]?.d ?? null;
  if (!snapshot) return report;
  report.snapshot = snapshot;
  if (apply && opts.date === undefined && snapshot < addDays(ubDate(), -2)) {
    throw new Error(`Хамгийн сүүлийн snapshot (${snapshot}) 2 хоногоос хуучин: sync ажиллаж байгаа эсэхийг шалгаад дахин оролдоно уу (эсвэл date-ийг тодорхой зааж өгнө үү)`);
  }

  const rows = await prisma.$queryRaw<{ warehouse_code: string; warehouse: string; item_code: string; item: string; unit: string; qty: string; amount: string }[]>`
    SELECT warehouse_code, min(warehouse) AS warehouse, item_code, min(item) AS item, min(unit) AS unit, sum(qty)::text AS qty, sum(amount)::text AS amount
      FROM onec_stock WHERE snapshot_date = ${snapshot}::date GROUP BY warehouse_code, item_code`;
  report.stockRows = rows.length;

  const warehouses = await prisma.warehouse.findMany({ where: { onecCode: { not: null }, isActive: true }, select: { id: true, onecCode: true } });
  const byCode = new Map<string, string[]>();
  for (const w of warehouses) {
    const code = (w.onecCode ?? "").trim();
    if (code) byCode.set(code, [...(byCode.get(code) ?? []), w.id]);
  }
  report.mappedWarehouses = byCode.size;
  report.ambiguousCodes = [...byCode].filter(([, ids]) => ids.length > 1).map(([c]) => c).sort();

  // 1) мөр бүрийг ангилна
  const cands: Cand[] = [];
  const unmapped = new Map<string, { name: string; items: Set<string> }>();
  for (const r of rows) {
    const code = r.item_code.trim();
    if (!code) {
      report.skipped.noItemCode++;
      continue;
    }
    const ids = byCode.get(r.warehouse_code.trim());
    if (!ids) {
      report.skipped.unmappedWarehouse++;
      const u = unmapped.get(r.warehouse_code) ?? { name: r.warehouse, items: new Set<string>() };
      u.items.add(code);
      unmapped.set(r.warehouse_code, u);
      continue;
    }
    if (ids.length > 1) {
      report.skipped.ambiguousWarehouse++;
      continue;
    }
    const qty = new Prisma.Decimal(r.qty).toDecimalPlaces(3);
    if (qty.lte(0)) {
      report.skipped.nonPositive++;
      continue;
    }
    if (qty.gt(MAX_QTY)) {
      report.skipped.tooLarge++;
      continue;
    }
    cands.push({ code, warehouseId: ids[0], qty, amount: new Prisma.Decimal(r.amount) });
  }
  report.unmapped = [...unmapped].map(([code, u]) => ({ code: code || "(код байхгүй)", name: u.name, items: u.items.size })).sort((a, b) => b.items - a.items || a.code.localeCompare(b.code)).slice(0, 30);

  // 2) Material: код бүрээр, байгаа нь хэвээр. Үнэ = оруулах мөрүүдийн жигнэсэн дундаж нэгж үнэ (дүн ÷ тоо)
  const info = new Map<string, { name: string; unit: string; qty: Prisma.Decimal; amount: Prisma.Decimal }>();
  const meta = new Map(rows.map((r) => [r.item_code.trim(), { name: r.item.trim(), unit: r.unit.trim() }]));
  for (const c of cands) {
    const cur = info.get(c.code) ?? { name: meta.get(c.code)?.name ?? "", unit: meta.get(c.code)?.unit ?? "", qty: new Prisma.Decimal(0), amount: new Prisma.Decimal(0) };
    cur.qty = cur.qty.plus(c.qty);
    cur.amount = cur.amount.plus(c.amount);
    info.set(c.code, cur);
  }
  const codes = [...info.keys()];
  const existingMaterials = new Map<string, string>();
  for (const part of chunks(codes)) for (const m of await prisma.material.findMany({ where: { code: { in: part } }, select: { id: true, code: true } })) existingMaterials.set(m.code, m.id);
  report.materials.existing = existingMaterials.size;
  const newMaterials = codes.filter((c) => !existingMaterials.has(c)).map((code) => {
    const i = info.get(code)!;
    const price = i.qty.gt(0) && i.amount.gt(0) ? i.amount.div(i.qty).toDecimalPlaces(2) : new Prisma.Decimal(0);
    if (!i.unit) report.materials.emptyUnit++;
    return { code, name: i.name || code, unit: i.unit || "ш", defaultPrice: price };
  });
  report.materials.toCreate = newMaterials.length;
  report.sample = newMaterials.slice(0, 5).map((m) => ({ code: m.code, name: m.name, unit: m.unit, price: m.defaultPrice.toFixed(2) }));

  // 3) InventoryBalance: байгаа Material-ийн байгаа үлдэгдэл хэвээр (refresh өгөөгүй бол)
  const existingBalances = new Map<string, { id: string; onHand: Prisma.Decimal; reserved: Prisma.Decimal }>();
  const matIds = [...existingMaterials.values()];
  for (const part of chunks(matIds)) {
    for (const b of await prisma.inventoryBalance.findMany({ where: { materialId: { in: part } }, select: { id: true, materialId: true, warehouseId: true, quantityOnHand: true, quantityReserved: true } })) {
      existingBalances.set(`${b.materialId}|${b.warehouseId}`, { id: b.id, onHand: b.quantityOnHand, reserved: b.quantityReserved });
    }
  }
  const toCreate: Cand[] = [];
  const toRefresh: { id: string; qty: Prisma.Decimal }[] = [];
  for (const c of cands) {
    const mid = existingMaterials.get(c.code);
    const cur = mid ? existingBalances.get(`${mid}|${c.warehouseId}`) : undefined;
    if (!cur) toCreate.push(c);
    else if (!refreshBalances) report.balances.existingKept++;
    else if (cur.reserved.gt(c.qty)) report.balances.refreshBlocked++;
    else if (!cur.onHand.equals(c.qty)) toRefresh.push({ id: cur.id, qty: c.qty });
    else report.balances.existingKept++;
  }
  report.balances.toCreate = toCreate.length;
  report.balances.toRefresh = toRefresh.length;

  if (!apply) return report;

  // 4) Бичих: нэг transaction (алдаа гарвал юу ч хагас үлдэхгүй). createMany skipDuplicates нь зэрэг ажиллах оролдлогоос хамгаална
  const startedAt = new Date();
  await prisma.$transaction(
    async (tx) => {
      for (const part of chunks(newMaterials)) report.created.materials += (await tx.material.createMany({ data: part, skipDuplicates: true })).count;
      const ids = new Map<string, string>();
      for (const part of chunks(codes)) for (const m of await tx.material.findMany({ where: { code: { in: part } }, select: { id: true, code: true } })) ids.set(m.code, m.id);
      const data = toCreate.flatMap((c) => {
        const materialId = ids.get(c.code);
        return materialId ? [{ materialId, warehouseId: c.warehouseId, quantityOnHand: c.qty, quantityReserved: new Prisma.Decimal(0) }] : [];
      });
      for (const part of chunks(data)) report.created.balances += (await tx.inventoryBalance.createMany({ data: part, skipDuplicates: true })).count;
      for (const u of toRefresh) {
        await tx.inventoryBalance.update({ where: { id: u.id }, data: { quantityOnHand: u.qty } });
        report.created.refreshed++;
      }
    },
    { timeout: 120_000, maxWait: 20_000 }
  );
  await prisma.onecSyncLog.create({
    data: {
      kind: "import-materials",
      period: snapshot,
      rows: report.created.balances,
      ok: true,
      message: `Material +${report.created.materials}, InventoryBalance +${report.created.balances}, шинэчилсэн ${report.created.refreshed}`,
      startedAt,
    },
  });
  return report;
}

export function describeImport(r: ImportReport): string {
  if (!r.snapshot) return "[import-materials] onec_stock хоосон: эхлээд sync ажиллуулна уу. Оруулах зүйл алга.";
  const lines = [
    `[import-materials] ${r.apply ? "APPLY" : "DRY-RUN: юу ч бичээгүй"} · snapshot ${r.snapshot} · ${r.stockRows} барааны×складын мөр · ${r.mappedWarehouses} склад onecCode-той${r.ambiguousCodes.length ? ` (давхар код: ${r.ambiguousCodes.join(", ")})` : ""}`,
    `[import-materials] алгассан: кодгүй бараа ${r.skipped.noItemCode}, onecCode-гүй склад ${r.skipped.unmappedWarehouse}, давхар кодтой склад ${r.skipped.ambiguousWarehouse}, үлдэгдэл ≤ 0 ${r.skipped.nonPositive}, хэт том ${r.skipped.tooLarge}`,
    `[import-materials] Material: байгаа ${r.materials.existing} (хөндөхгүй), шинээр ${r.materials.toCreate}${r.materials.emptyUnit ? ` (нэгжгүй ${r.materials.emptyUnit} → "ш")` : ""}`,
    `[import-materials] InventoryBalance: шинээр ${r.balances.toCreate}, байгаа ${r.balances.existingKept} (дарахгүй)${r.refreshBalances ? `, шинэчлэх ${r.balances.toRefresh}, нөөцөөс бага тул алгассан ${r.balances.refreshBlocked}` : ""}`,
  ];
  if (r.sample.length) lines.push(`[import-materials] жишээ: ${r.sample.map((s) => `${s.code} «${s.name}» ${s.unit} ${s.price}₮`).join(" | ")}`);
  if (r.unmapped.length) lines.push(`[import-materials] onecCode-гүй 1С склад (хамгийн их барааны дагуу): ${r.unmapped.slice(0, 8).map((u) => `${u.code} «${u.name}» ${u.items}`).join("; ")}${r.unmapped.length > 8 ? "; ..." : ""}`);
  if (r.apply) lines.push(`[import-materials] үүсгэсэн: Material ${r.created.materials}, InventoryBalance ${r.created.balances}, шинэчилсэн ${r.created.refreshed}`);
  else lines.push("[import-materials] Үнэхээр бичихийн тулд --apply");
  return lines.join("\n");
}
