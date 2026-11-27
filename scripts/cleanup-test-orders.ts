// Ашиглалтад оруулахын өмнөх НЭГ УДАА цэвэрлэгээ: туршилтын захиалгуудыг (мөр, батлалтын түүх, мэдэгдэл, хавсралтын мөр, агуулахын файл) устгана.
// 1С-д огт хамаагүй. Хэрэглэгч, хэлтэс, тохиргоо, материал, 1С-ийн өгөгдөлд ХҮРЭХГҮЙ.
//
//   npm run cleanup:test-orders -- --before 2026-11-28            DRY-RUN (анхдагч): юу устахыг жагсаана, юуг ч устгахгүй
//   npm run cleanup:test-orders -- --ids UB-2026-0001,UB-2026-0002  (id эсвэл захиалгын дугаар)
//   npm run cleanup:test-orders -- --before 2026-11-28 --apply    ҮНЭХЭЭР устгана
//   --include-finance   санхүүд бүртгэгдсэн захиалгыг ч устгана (анхдагч: алгасна)
//   --actor <email>     аудит логт бичигдэх ADMIN (анхдагч: идэвхтэй ADMIN)
// --before нь Улаанбаатарын цагаар тухайн өдрийн 00:00-аас ӨМНӨ үүссэн захиалга.
import { prisma } from "../lib/prisma";
import { applyCleanup, parseBeforeDate, planCleanup, type CleanupPlan } from "../lib/request-delete";

export interface CleanupArgs {
  before?: string;
  ids?: string[];
  apply: boolean;
  includeFinance: boolean;
  actor?: string;
}

export function parseArgs(argv: string[]): CleanupArgs {
  const a: CleanupArgs = { apply: false, includeFinance: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--apply") a.apply = true;
    else if (v === "--include-finance") a.includeFinance = true;
    else if (v === "--before") a.before = argv[++i];
    else if (v === "--ids") a.ids = (argv[++i] ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    else if (v === "--actor") a.actor = argv[++i];
    else throw new Error(`Үл мэдэгдэх аргумент: ${v}`);
  }
  if (!a.before && !(a.ids && a.ids.length)) throw new Error("--before YYYY-MM-DD эсвэл --ids <id,...> заавал өгнө");
  if (a.before && a.ids?.length) throw new Error("--before ба --ids хоёрыг зэрэг өгч болохгүй");
  return a;
}

const money = (v: number | null) => (v === null ? "—" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(v));

export function formatPlan(plan: CleanupPlan, apply: boolean): string {
  const out: string[] = [];
  out.push(apply ? "=== УСТГАЛ (--apply) ===" : "=== DRY-RUN: юуг ч устгаагүй ===");
  for (const t of plan.targets) {
    out.push(
      `  ${t.requestNumber} | ${t.status} | ${t.createdAt.toISOString().slice(0, 10)} | ${t.requesterName} | ${money(t.totalAmount)}₮ | мөр ${t.counts.items}, алхам ${t.counts.approvalSteps}, түүх ${t.counts.approvalActions}, мэдэгдэл ${t.counts.notifications}, хавсралт ${t.counts.attachments + t.counts.receipts}, файл ${t.storageKeys.length}${t.financeRecorded ? " [САНХҮҮД БҮРТГЭГДСЭН]" : ""}`
    );
  }
  for (const s of plan.skippedFinance) out.push(`  АЛГАСАВ (санхүүд бүртгэгдсэн): ${s.requestNumber} | ${s.status} | ${money(s.totalAmount)}₮`);
  for (const n of plan.notFound) out.push(`  ОЛДСОНГҮЙ: ${n}`);
  const t = plan.totals;
  out.push(
    "",
    `Устах захиалга: ${t.requests}`,
    `  мөр: ${t.items}, батлалтын түүх: ${t.approvalActions}, мэдэгдэл: ${t.notifications}`,
    `  хавсралт/баримтын мөр: ${t.attachmentRows}, агуулахын файл (thumb-тэй): ${t.storageObjects}`,
    `  алгассан (санхүүд бүртгэгдсэн): ${plan.skippedFinance.length}`,
    `  анхаар: агуулахаас олгогдсон нөөц (${t.stockIssues} олголт) буцаагдахгүй`
  );
  if (!apply) out.push("", "Үнэхээр устгахын тулд --apply нэмнэ.");
  return out.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const filter = { before: args.before ? parseBeforeDate(args.before) : undefined, ids: args.ids };
  const plan = await planCleanup(filter, { includeFinance: args.includeFinance });
  console.log(formatPlan(plan, args.apply));
  if (!args.apply) return;
  if (plan.targets.length === 0) return;

  const actor = await prisma.user.findFirst({ where: args.actor ? { email: args.actor, role: "ADMIN" } : { role: "ADMIN", isActive: true }, select: { id: true, email: true } });
  if (!actor) throw new Error("Аудитад бичих ADMIN хэрэглэгч олдсонгүй");
  const r = await applyCleanup(plan, actor.id, { includeFinance: args.includeFinance });
  console.log(`\nУстгагдсан: ${r.deleted.length}${r.failed.length ? `, АМЖИЛТГҮЙ: ${r.failed.map((f) => `${f.requestNumber} (${f.error})`).join("; ")}` : ""}`);
  if (r.storageFailed.length) console.log(`Агуулахаас устгаж чадаагүй файл: ${r.storageFailed.length} (аудит логт түлхүүрүүдтэй)`);
  if (r.failed.length) process.exitCode = 1;
}

if (process.argv[1] && /cleanup-test-orders\.[cm]?[jt]s$/.test(process.argv[1])) {
  main()
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
