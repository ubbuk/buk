// Гараар ажиллуулах 1С sync команд (.env-ийг --env-file-аар уншина)
//
//   npm run sync:1c -- stock                    -> өнөөдрийн агуулахын үлдэгдэл
//   npm run sync:1c -- stock 2026-10-31         -> тухайн өдрийн үлдэгдэл
//   npm run sync:1c -- receivables [2026-10-31] -> өнөөдрийн авлагын агшин зураг
//   npm run sync:1c -- receivables-odata [2026-10 | 2026-10-31] -> «Авлага» табын агшин зураг (OData Balance, ONEC_ODATA_*); сар өгвөл сарын эцэс/өнөөдөр
//   npm run sync:1c -- snapshots               -> мониторингийн «1С · Санхүүгийн тойм»: өнөөдрийн мөнгөний үлдэгдэл (onec_cash_balance) + энэ сарын зарцуулалт (onec_usage_month)
//   npm run sync:1c -- payroll                  -> «Цалин» табын сарын нийт дүн (onec_payroll_month): Postgres-д байхгүй бүх сар + сүүлийн 2 сар. Зөвхөн байгууллагын нийт дүн, хүн/хэлтэс хадгалахгүй
//   npm run sync:1c -- closing                  -> 1-2-р сард өмнөх оны 12-р сарын (бааз, хаалтын засвар) борлуулалт, P&L, агуулах, авлага (ONEC_BASES шаардана)
//   npm run sync:1c -- health                   -> одоогийн оны баазад сүүлийн 7 хоногт шинэ баримт орсон эсэх; хоцорсон бол ADMIN-д мэдэгдэл (exit 1)
//   npm run sync:1c -- current                  -> энэ сарын борлуулалт + P&L
//   npm run sync:1c -- recent                   -> энэ сар + өмнөх сар
//   npm run sync:1c -- range 2026-01 2026-10    -> эхний удаа өнгөрсөн саруудыг татах
//   npm run sync:1c -- prune                    -> DRY-RUN: хуучин snapshot, sync_log-ийн хадгалалтын бодлогоор юу устахыг харуулна (lib/onec/retention.ts)
//   npm run sync:1c -- prune --apply            -> үнэхээр устгана (max(snapshot_date)-ийг хэзээ ч устгахгүй)
//   npm run sync:1c -- import-materials         -> DRY-RUN: onec_stock-оос Material + InventoryBalance (Warehouse.onecCode-той складууд) оруулах тайлан
//   npm run sync:1c -- import-materials --apply [--date=2026-11-17] [--refresh-balances]  -> үнэхээр оруулна (lib/onec/material-import.ts)
//   ... --force                                 -> 1С 0 мөр буцаасан ч солих
import { prisma } from "../lib/prisma";
import { closingTargets, multiYear } from "../lib/onec/bases";
import { asOfDate } from "../lib/onec/dates";
import { checkCurrentBase, STALE_MESSAGE } from "../lib/onec/health";
import { describeImport, importMaterials } from "../lib/onec/material-import";
import { syncReceivablesSnapshotLocked } from "../lib/onec/receivables-store";
import { syncPayroll } from "../lib/onec/payroll-store";
import { syncSnapshots } from "../lib/onec/snapshots-store";
import { describeRetention, runRetention } from "../lib/onec/retention";
import { addMonths, currentMonth, isDate, isMonth, monthsBetween, syncMonth, syncReceivables, syncStock, today } from "../lib/onec/sync";

async function main() {
  const [mode = "current", a, b] = process.argv.slice(2).filter((x) => !x.startsWith("--"));
  const force = process.argv.includes("--force");
  const apply = process.argv.includes("--apply"); // prune, import-materials: --apply-гүй бол DRY-RUN
  const flag = (name: string) => process.argv.find((x) => x.startsWith(`--${name}=`))?.slice(name.length + 3);

  if (mode === "prune") {
    console.log(describeRetention(await runRetention({ apply })));
    return;
  }

  if (mode === "import-materials") {
    console.log(describeImport(await importMaterials({ apply, date: flag("date"), refreshBalances: process.argv.includes("--refresh-balances") })));
    return;
  }

  if (mode === "stock") {
    const date = a ?? today();
    if (!isDate(date)) throw new Error("Жишээ: stock 2026-10-31");
    await syncStock(date, force);
    return;
  }

  if (mode === "receivables") {
    const date = a ?? today();
    if (!isDate(date)) throw new Error("Жишээ: receivables 2026-10-31");
    await syncReceivables(date, force);
    return;
  }

  if (mode === "snapshots") {
    // Хоёр алхам бие даасан: нэг нь унасан ч нөгөө нь ажиллана, алдаа onec_sync_log-д (ok=false) тэмдэглэгдэнэ; аль нэг унасан бол exit 1
    for (const r of await syncSnapshots()) {
      if (r.ok) console.log(`[${r.kind} ${r.period}] ${r.rows} мөр, ${r.message}`);
      else {
        console.error(`[${r.kind} ${r.period}] АЛДАА: ${r.message}`);
        process.exitCode = 1;
      }
    }
    return;
  }

  if (mode === "payroll") {
    // Сар бүр бие даасан: нэг сар унасан ч бусад үргэлжилнэ, алдаа onec_sync_log-д (ok=false); аль нэг унасан бол exit 1
    for (const r of await syncPayroll()) {
      if (r.ok) console.log(`[${r.kind} ${r.period}] ${r.rows} мөр, ${r.message}`);
      else {
        console.error(`[${r.kind} ${r.period}] АЛДАА: ${r.message}`);
        process.exitCode = 1;
      }
    }
    return;
  }

  if (mode === "health") {
    const { health, notified } = await checkCurrentBase();
    if (!health.configured) console.warn(`[health ${health.year}] Энэ оны 1С бааз холбогдоогүй`);
    else if (health.unreachable) console.warn(`[health ${health.year}] 1С холбогдсонгүй: шалгаж чадсангүй`);
    else if (health.stale) {
      console.error(`[health ${health.year}] ${STALE_MESSAGE} Сүүлийн баримт: ${health.lastDocument ?? "алга"}. ADMIN-д мэдэгдэл: ${notified}`);
      process.exitCode = 1;
    } else console.log(`[health ${health.year}] сүүлийн баримт ${health.lastDocument} (${health.daysSince} хоногийн өмнө)`);
    return;
  }

  if (mode === "closing") {
    const t = closingTargets(today());
    if (!t) return console.log("[closing] 1-2-р сар биш: алгасав");
    // Хуучин нэг баазын горимд (ONEC_BASES байхгүй) бүх жил нэг баазаас татагддаг тул өмнөх оны сарыг дахин татахгүй (буруу өгөгдөл бичихээс сэргийлнэ)
    if (!multiYear()) return console.log("[closing] ONEC_BASES тохируулаагүй: алгасав");
    let ok = true;
    for (const ym of t.months) ok = (await syncMonth(ym, force)) && ok;
    try {
      await syncStock(t.stockDate, force);
    } catch {
      ok = false;
    }
    const r = await syncReceivablesSnapshotLocked(asOfDate(t.receivablesMonth)).catch(() => ({ ok: false }) as const);
    if (!r || !r.ok) ok = false;
    if (!ok) process.exitCode = 1;
    return;
  }

  if (mode === "receivables-odata") {
    const date = a === undefined ? today() : isMonth(a) ? asOfDate(a) : a;
    if (!isDate(date)) throw new Error("Жишээ: receivables-odata 2026-10 (эсвэл 2026-10-31)");
    const r = await syncReceivablesSnapshotLocked(date);
    if (!r) console.warn("[receivables-odata] өөр татаалт явж байна (түрээс завгүй), алгасаллаа");
    else if (!r.ok) {
      console.error(`[receivables-odata ${date}] АЛДАА: татаж чадаагүй данс ${r.failed.join(", ")}`);
      process.exitCode = 1;
    } else console.log(`[receivables-odata ${date}] ${r.rows} мөр`);
    return;
  }

  let months: string[];
  if (mode === "current") months = [currentMonth()];
  else if (mode === "recent") months = [addMonths(currentMonth(), -1), currentMonth()];
  else if (mode === "range") {
    if (!isMonth(a) || !isMonth(b)) throw new Error("Жишээ: range 2026-01 2026-10");
    months = monthsBetween(a, b);
  } else throw new Error(`Мэдэгдэхгүй горим: ${mode} (stock | receivables | receivables-odata | snapshots | payroll | closing | health | prune | import-materials | current | recent | range)`);

  let allOk = true;
  // 1С-д ачаалал өгөхгүйн тулд сар сараар дараалан татна
  for (const ym of months) allOk = (await syncMonth(ym, force)) && allOk;
  if (!allOk) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
