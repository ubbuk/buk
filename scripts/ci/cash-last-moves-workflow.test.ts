import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// «Мөнгөн хөрөнгө» табын дансны сүүлийн гүйлгээ: sync горимууд (cash-last-moves, cash-last-moves-backfill) GitHub workflow, sync-1c.ts CLI-д бүртгэгдсэн эсэх.
// (lib/onec/cash-last-store.test.ts нь логикийг шалгана.) Хуудас нь 1С руу хандахгүй, зөвхөн sync бичсэн DB-ээс уншина.
const root = path.resolve(__dirname, "../..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8").replace(/\r\n/g, "\n");
const yml = read(".github/workflows/sync-1c.yml");
const cli = read("scripts/sync-1c.ts");

const caseBody = (name: string) => {
  const start = yml.indexOf(`            ${name})\n`);
  expect(start, `case ${name}`).toBeGreaterThan(-1);
  return yml.slice(start, yml.indexOf(";;", start));
};

describe("sync-1c.yml", () => {
  it("cash-last-moves, cash-last-moves-backfill горим гараар сонгогдоно", () => {
    const options = /options: \[([^\]]+)\]/.exec(yml)![1].split(",").map((s) => s.trim());
    expect(options).toContain("cash-last-moves");
    expect(options).toContain("cash-last-moves-backfill");
  });
  it("regular дотор cash-last-moves ажиллана (OData тохиргоотой үед л); өөр cron нэмээгүй", () => {
    const regular = caseBody("regular");
    expect(regular).toContain("run cash-last-moves 600 npm run sync:1c -- cash-last-moves");
    expect(regular).toMatch(/if odata_ready; then run cash-last-moves /);
    expect(yml.match(/- cron: /g)).toHaveLength(4);
  });
  it("cash-last-moves горим дангаараа", () => {
    expect(caseBody("cash-last-moves")).toContain("npm run sync:1c -- cash-last-moves");
  });
  it("cash-last-moves-backfill: from, to (YYYY-MM) шалгаж, 15 сек завсарлагатай, force-г дамжуулна; нэг удаад ≤ 24 сар (CLI шалгана)", () => {
    const b = caseBody("cash-last-moves-backfill");
    expect(b).toContain("$month_re");
    expect(b).toContain("exit 1");
    expect(b).toContain('npm run sync:1c -- cash-last-moves-backfill "$INPUT_FROM" "$INPUT_TO" --pause=15 $force_flag');
    expect(b).toContain('if [ "$INPUT_FORCE" = "true" ]; then force_flag="--force"; fi');
  });
  it("regular нь production-backfill, cash-last-moves-backfill-ийг дуудахгүй (нэг удаагийн нөхөлт)", () => {
    expect(caseBody("regular")).not.toContain("cash-last-moves-backfill");
    expect(caseBody("regular")).not.toContain("production-backfill");
  });
  it("force input нь cash-last-moves-backfill-д мөн хамаарна (тайлбарт дурдсан)", () => {
    expect(/force:\n {8}description: "([^"]+)"/.exec(yml)![1]).toContain("cash-last-moves-backfill");
  });
});

describe("scripts/sync-1c.ts", () => {
  it("cash-last-moves, cash-last-moves-backfill горим бүртгэгдсэн; backfill нь --pause, --force-ийг дамжуулна", () => {
    expect(cli).toContain('mode === "cash-last-moves"');
    expect(cli).toContain("await syncCashLastMoves()");
    expect(cli).toContain('mode === "cash-last-moves-backfill"');
    expect(cli).toMatch(/backfillCashLastMoves\(\{ from: a \?\? "", to: b \?\? a \?\? "", pauseSeconds: .*force \}\)/);
    expect(cli).toContain("cash-last-moves | cash-last-moves-backfill");
  });
});

describe("хуудас 1С руу хандахгүй", () => {
  it("«Данснууд» хуудас, API-ууд сүүлийн гүйлгээг хайх 1С-ийн хүсэлтгүй: lib/onec/cash-last-store.ts-ийн уншилт зөвхөн DB; хуудасны хуудас нэмэлт endpoint дууддаггүй", () => {
    const page = read("app/(app)/finance/cash/page.tsx");
    expect(page).not.toContain("last-moves");
    const store = read("lib/onec/cash-last-store.ts");
    // уншилтын функцүүд (readLatestMoves, readMoveBefore, isLastMoveBackfilled) fetchCash-ийг дууддаггүй: зөвхөн sync функцүүд
    const readers = store.slice(store.indexOf("хуудасны уншилт"));
    expect(readers).not.toMatch(/fetchCash|odataRows|fetch\(/);
    expect(readers).toContain("onec_cash_last_move");
    for (const f of ["app/api/dashboard/cash/accounts/route.ts", "app/api/dashboard/cash/account/route.ts"]) {
      const src = read(f);
      expect(src, f).toContain("cash-last-store");
      expect(src, f).not.toMatch(/syncCashLast|backfillCashLast|fetchCash\(/);
    }
  });
});
