import type { PrismaClient } from "@prisma/client";

// The warehouse structure agreed with the business: two levels. The top level is the keeper group (it owns the
// keeper), the lower level is a 1С warehouse (Справочник.Склады) with its 1С code in `onecCode`. Shared by seed.ts and
// seed.production.ts. Idempotent, and it never overwrites what an administrator changed later: keepers and
// priorities are written only when a row is created (the one exception is the pre-existing central warehouse, see
// below). `onecCode` is business-confirmed mapping data, so it is set on every run.
//
// NOT here yet: the finished-goods warehouses that must never be reserved from (00-000010, 00-000030, 00-000003).
// They need a "do not reserve" flag that the schema does not have yet; they are added together with it.

interface Location {
  id: string;
  slug: string;
  /** The 1С warehouse name, exactly as the sync delivers it. */
  name: string;
  onecCode: string;
  sortPriority?: number;
}
interface Top {
  id: string;
  slug: string;
  name: string;
  keeper?: "uuganzetseg";
  locations: Location[];
}

const loc = (onecCode: string, name: string, extra: Partial<Location> = {}): Location => ({
  id: `w-1c-${onecCode}`,
  slug: `1c-${onecCode}`,
  name,
  onecCode,
  ...extra,
});

export const WAREHOUSE_STRUCTURE: Top[] = [
  {
    id: "w-bold",
    slug: "bold",
    name: "Болд",
    locations: [
      loc("00-000005", "Механик цехийн агуулах"),
      loc("00-000016", "Бутлан ангилах үйлдвэр"),
      loc("00-000009", "Арматур цехийн агуулах"),
      loc("00-000017", "Силосын агуулах /цемент/"),
      loc("00-000019", "РБУ -ТБЗҮйлдвэрийн агуулах"),
    ],
  },
  {
    id: "w-uuganzetseg",
    slug: "uuganzetseg",
    name: "Ууганцэцэг (хангамж)",
    keeper: "uuganzetseg",
    locations: [
      // "w-central" is the warehouse that already exists in every database (stock rows point at it), so it is
      // re-used for the 1С "Хангамжийн агуулах" rather than replaced. It is the first one stock is taken from.
      { id: "w-central", slug: "tov-aguulah", name: "Хангамжийн агуулах", onecCode: "00-000002", sortPriority: 10 },
      loc("00-000026", "Гүүрэн краны засварын хэсгийн агуулах"),
      loc("00-000024", "Сантехник хэсгийн агуулах"),
      loc("00-000025", "Цахилгааны хэсгийн агуулах"),
      loc("00-000023", "Тоног төхөөрөмжийн засварын хэсгийн агуулах"),
    ],
  },
  {
    id: "w-sarangerel",
    slug: "sarangerel",
    name: "Сарангэрэл",
    locations: [
      loc("00-000018", "Төмөр замын бетон дэрний цехийн агуулах"),
      loc("00-000007", "Төмөр бетон хийц эдлэлийн цехийн агуулах"),
      loc("00-000013", "БАЗ-3 цехийн агуулах"),
      loc("00-000021", "БАЗ-4 цехийн агуулах"),
      loc("00-000027", "Жижиг бетон эдлэлийн агуулах"),
      loc("00-000022", "Химийн нэмэлтийн агуулах"),
      loc("00-000015", "Вольтамискын агуулах"),
      loc("00-000014", "Тенсландын агуулах ХНХ"),
    ],
  },
  {
    id: "w-boogii",
    slug: "boogii",
    name: "Боогий",
    locations: [loc("00-000008", "Цайны газрын агуулах")],
  },
  // No keeper: a request that would go here is routed to the primary keeper (lib/warehouse-keeper.ts).
  {
    id: "w-gadna-talbai",
    slug: "nyarvargui",
    name: "Нярваргүй агуулахууд",
    locations: [
      loc("000000001", "Гадаа талбайн агуулах"),
      loc("00-000012", "Гадаа талбайн ТЭМ"),
      loc("00-000029", "Компанийн засвар үйлчилгээний агуулах"),
    ],
  },
];

/** Locations an earlier version of the seed invented. Removed (only when nothing refers to them) because the lower level is 1С. */
export const OBSOLETE_WAREHOUSE_IDS = [
  "w-bold-meh",
  "w-bold-butluur",
  "w-bold-armatur",
  "w-bold-silos",
  "w-zasvar",
  "w-sar-tomor-beton",
  "w-sar-tomor-beton-hooloi",
  "w-sar-kolitso",
  "w-sar-70x90",
  "w-sar-baz-3-4",
  "w-boogii-tsainy-gazar",
];

export interface WarehouseSeedResult {
  removed: string[];
  /** Obsolete rows that still hold stock or reservations: left in place, for a person to decide. */
  kept: string[];
}

export async function seedWarehouseStructure(prisma: PrismaClient, opts: { uuganzetsegKeeperId?: string } = {}): Promise<WarehouseSeedResult> {
  for (const top of WAREHOUSE_STRUCTURE) {
    const keeperId = top.keeper === "uuganzetseg" ? opts.uuganzetsegKeeperId ?? null : null;
    await prisma.warehouse.upsert({
      where: { id: top.id },
      update: { name: top.name, slug: top.slug, parentId: null },
      create: { id: top.id, name: top.name, slug: top.slug, keeperId },
    });
    for (const l of top.locations) {
      await prisma.warehouse.upsert({
        where: { id: l.id },
        update: { name: l.name, slug: l.slug, parentId: top.id, onecCode: l.onecCode },
        create: { id: l.id, name: l.name, slug: l.slug, parentId: top.id, onecCode: l.onecCode, sortPriority: l.sortPriority ?? 100 },
      });
    }
  }
  // The pre-existing central warehouse keeps whatever priority an administrator gave it; only the untouched default moves.
  await prisma.warehouse.updateMany({ where: { id: "w-central", sortPriority: 100 }, data: { sortPriority: 10 } });

  await prisma.systemSetting.upsert({
    where: { key: "step2_keeper_mode" },
    update: {},
    create: { key: "step2_keeper_mode", value: "PRIMARY" },
  });

  const result: WarehouseSeedResult = { removed: [], kept: [] };
  for (const id of OBSOLETE_WAREHOUSE_IDS) {
    const row = await prisma.warehouse.findUnique({ where: { id }, select: { id: true } });
    if (!row) continue;
    const [balances, reservations, children] = await Promise.all([
      prisma.inventoryBalance.count({ where: { warehouseId: id } }),
      prisma.stockReservation.count({ where: { warehouseId: id } }),
      prisma.warehouse.count({ where: { parentId: id } }),
    ]);
    if (balances + reservations + children > 0) {
      result.kept.push(id);
      continue;
    }
    await prisma.warehouse.delete({ where: { id } });
    result.removed.push(id);
  }
  return result;
}
