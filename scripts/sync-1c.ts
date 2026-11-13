// Гараар ажиллуулах 1С sync команд (.env-ийг --env-file-аар уншина)
//
//   npm run sync:1c -- stock                    -> өнөөдрийн агуулахын үлдэгдэл
//   npm run sync:1c -- stock 2026-10-31         -> тухайн өдрийн үлдэгдэл
//   npm run sync:1c -- receivables [2026-10-31] -> өнөөдрийн авлагын агшин зураг
//   npm run sync:1c -- current                  -> энэ сарын борлуулалт + P&L + мөнгөн хөрөнгө
//   npm run sync:1c -- recent                   -> энэ сар + өмнөх сар
//   npm run sync:1c -- range 2026-01 2026-10    -> эхний удаа өнгөрсөн саруудыг татах
//   ... --force                                 -> 1С 0 мөр буцаасан ч солих
import { prisma } from "../lib/prisma";
import { addMonths, currentMonth, isDate, isMonth, monthsBetween, syncMonth, syncReceivables, syncStock, today } from "../lib/onec/sync";

async function main() {
  const [mode = "current", a, b] = process.argv.slice(2).filter((x) => !x.startsWith("--"));
  const force = process.argv.includes("--force");

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

  let months: string[];
  if (mode === "current") months = [currentMonth()];
  else if (mode === "recent") months = [addMonths(currentMonth(), -1), currentMonth()];
  else if (mode === "range") {
    if (!isMonth(a) || !isMonth(b)) throw new Error("Жишээ: range 2026-01 2026-10");
    months = monthsBetween(a, b);
  } else throw new Error(`Мэдэгдэхгүй горим: ${mode} (stock | receivables | current | recent | range)`);

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
