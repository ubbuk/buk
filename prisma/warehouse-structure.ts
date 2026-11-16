import type { PrismaClient } from "@prisma/client";

// The warehouse structure agreed with the business: two levels, the keeper on the top level and the locations below.
// Shared by seed.ts and seed.production.ts. Idempotent, and it never overwrites what an administrator changed later:
// keepers and priorities are written only when a row is created (the one exception is the pre-existing central
// warehouse, see below). 1С codes are NOT set here: they are filled in by hand after the mapping report is confirmed
// (scripts/onec-warehouse-mapping.ts).

interface Top {
  id: string;
  slug: string;
  name: string;
  keeper?: "uuganzetseg";
  locations: { id: string; slug: string; name: string; location?: string; sortPriority?: number }[];
}

export const WAREHOUSE_STRUCTURE: Top[] = [
  {
    id: "w-bold",
    slug: "bold",
    name: "Болд",
    locations: [
      { id: "w-bold-meh", slug: "mehanik-tseh", name: "Механик цех 1, 2" },
      { id: "w-bold-butluur", slug: "butluur", name: "Бутлуур" },
      { id: "w-bold-armatur", slug: "armatur", name: "Арматур" },
      { id: "w-bold-silos", slug: "silos", name: "Силос" },
    ],
  },
  {
    id: "w-uuganzetseg",
    slug: "uuganzetseg",
    name: "Ууганцэцэг (хангамж)",
    keeper: "uuganzetseg",
    locations: [
      // "w-central" is the warehouse that already exists in every database (stock rows point at it), so it is
      // re-parented rather than replaced. It is the first one stock is taken from.
      { id: "w-central", slug: "tov-aguulah", name: "Төв агуулах", location: "Үйлдвэрийн талбай", sortPriority: 10 },
      { id: "w-zasvar", slug: "zasvar", name: "Засвар (кран, сантехник, цахилгаан)" },
    ],
  },
  {
    id: "w-sarangerel",
    slug: "sarangerel",
    name: "Сарангэрэл",
    locations: [
      { id: "w-sar-tomor-beton", slug: "tomor-beton", name: "Төмөр бетон" },
      { id: "w-sar-tomor-beton-hooloi", slug: "tomor-beton-hooloi", name: "Төмөр бетон хоолой" },
      { id: "w-sar-kolitso", slug: "kolitso", name: "Колицо" },
      { id: "w-sar-70x90", slug: "70x90", name: "70×90" },
      { id: "w-sar-baz-3-4", slug: "baz-3-4", name: "Бааз 3, 4" },
    ],
  },
  {
    id: "w-boogii",
    slug: "boogii",
    name: "Боогий",
    locations: [{ id: "w-boogii-tsainy-gazar", slug: "tsainy-gazar", name: "Цайны газар" }],
  },
  // No keeper yet: requests that would go here are routed to the primary keeper.
  { id: "w-gadna-talbai", slug: "gadna-talbai", name: "Гадна талбай", locations: [] },
];

export async function seedWarehouseStructure(prisma: PrismaClient, opts: { uuganzetsegKeeperId?: string } = {}) {
  for (const top of WAREHOUSE_STRUCTURE) {
    const keeperId = top.keeper === "uuganzetseg" ? opts.uuganzetsegKeeperId ?? null : null;
    await prisma.warehouse.upsert({
      where: { id: top.id },
      update: { name: top.name, slug: top.slug, parentId: null },
      create: { id: top.id, name: top.name, slug: top.slug, keeperId },
    });
    for (const loc of top.locations) {
      await prisma.warehouse.upsert({
        where: { id: loc.id },
        update: { name: loc.name, slug: loc.slug, parentId: top.id },
        create: { id: loc.id, name: loc.name, slug: loc.slug, location: loc.location, parentId: top.id, sortPriority: loc.sortPriority ?? 100 },
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
}
