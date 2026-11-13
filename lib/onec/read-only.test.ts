/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";

// 1С-ээс татах бүх код ЗӨВХӨН УНШДАГ: 1С руу бичих (POST/PUT/PATCH/DELETE) код байхгүй.
const sources = import.meta.glob(["/lib/onec/client.ts", "/lib/onec/sync.ts", "/lib/onec/refresh.ts", "/lib/onec/odata-read.ts", "/lib/onec/odata-cache.ts", "/lib/onec/usage.ts", "/lib/onec/receivables.ts", "/lib/onec/receivables-store.ts", "/lib/onec/cash.ts", "/lib/onec/wip.ts", "/app/api/dashboard/health/route.ts", "/lib/onec/bases.ts", "/lib/onec/pl-tax.ts", "/app/api/dashboard/wip/route.ts", "/app/api/dashboard/cash/route.ts", "/app/api/dashboard/refresh/route.ts", "/app/api/dashboard/usage/route.ts", "/app/api/dashboard/expenses/route.ts", "/app/api/dashboard/receivables/route.ts", "/app/api/dashboard/year/route.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("1С sync and refresh code never writes to 1С", () => {
  it("the only outgoing requests are GETs: the 1С client and the OData client (lib/onec-odata/client.ts)", () => {
    expect(Object.keys(sources)).toHaveLength(20);
    for (const [path, text] of Object.entries(sources)) {
      const c = code(text);
      expect(c, path).not.toMatch(/method\s*:\s*["'`](?!GET["'`])/i);
      expect(c, path).not.toMatch(/\bbody\s*:/);
      expect(c, path).not.toMatch(/XMLHttpRequest|axios|node-fetch/);
      if (!path.endsWith("/client.ts")) expect(c, path).not.toMatch(/(?<![.\w])fetch\s*\(/); // opts.fetch() (a callback) is not the network call
    }
  });
});
