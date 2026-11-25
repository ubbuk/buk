import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// «Үйлдвэрлэл» табын sync горимууд GitHub workflow болон sync-1c.ts CLI-д бүртгэгдсэн эсэх (lib/onec/production-store.test.ts нь логикийг шалгана).
const root = path.resolve(__dirname, "../..");
const yml = readFileSync(path.join(root, ".github/workflows/sync-1c.yml"), "utf8").replace(/\r\n/g, "\n");
const cli = readFileSync(path.join(root, "scripts/sync-1c.ts"), "utf8").replace(/\r\n/g, "\n");

/** `case` хэсгийн тал: "regular)" -> дараагийн ";;" хүртэлх текст */
const caseBody = (name: string) => {
  const start = yml.indexOf(`            ${name})\n`);
  expect(start, `case ${name}`).toBeGreaterThan(-1);
  return yml.slice(start, yml.indexOf(";;", start));
};

describe("sync-1c.yml", () => {
  it("production-month, production-backfill горим гараар сонгогдоно", () => {
    const options = /options: \[([^\]]+)\]/.exec(yml)![1].split(",").map((s) => s.trim());
    expect(options).toContain("production-month");
    expect(options).toContain("production-backfill");
  });

  it("regular (15 минут тутам) дотор production-month ажиллана, OData тохиргоотой үед л", () => {
    const regular = caseBody("regular");
    expect(regular).toContain("run production-month 300 npm run sync:1c -- production-month");
    expect(regular).toMatch(/if odata_ready; then run production-month /);
  });

  it("production-month горим дангаараа, production-backfill from/to (YYYY-MM) шалгаж, завсарлагатай ажиллана", () => {
    expect(caseBody("production-month")).toContain("npm run sync:1c -- production-month");
    const backfill = caseBody("production-backfill");
    expect(backfill).toContain("$INPUT_FROM");
    expect(backfill).toContain("$month_re");
    expect(backfill).toContain("exit 1");
    expect(backfill).toContain('npm run sync:1c -- production-backfill "$INPUT_FROM" "$INPUT_TO" --pause=15');
  });

  it("«Цалин»-ийн тусдаа хуваарь өөрчлөгдөөгүй, production regular-аас гадуур өөр cron нэмээгүй", () => {
    expect(yml.match(/- cron: /g)).toHaveLength(4);
  });
});

describe("scripts/sync-1c.ts", () => {
  it("production-month, production-backfill горим бүртгэгдсэн; backfill нь --pause, --force-ийг дамжуулна", () => {
    expect(cli).toContain('mode === "production-month"');
    expect(cli).toContain("await syncProduction()");
    expect(cli).toContain('mode === "production-backfill"');
    expect(cli).toMatch(/backfillProduction\(\{ from: a \?\? "", to: b \?\? a \?\? "", pauseSeconds: .*force \}\)/);
    expect(cli).toContain("production-month | production-backfill");
  });
});
