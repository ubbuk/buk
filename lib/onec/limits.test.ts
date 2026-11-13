/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { defaultFetchOpts } from "./client";

// 1С руу хандах route-ууд Vercel-ийн функцийн хугацааны хязгаарыг (maxDuration) тодорхой зарлах ёстой: анхдагч нь төлөвлөгөөнөөс
// хамаарч 10 сек байж болно. Хүнд татаалт (сар, авлагын агшин зураг) Vercel-ийн route дээр биш GitHub Actions дээр ажиллана.
const routes = import.meta.glob(["/app/api/dashboard/refresh/route.ts", "/app/api/dashboard/usage/route.ts", "/app/api/dashboard/cash/route.ts", "/app/api/onec-odata/data/route.ts", "/app/api/onec-odata/objects/route.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

describe("1С route-уудын maxDuration", () => {
  it("1С-ээс шууд уншдаг route бүр maxDuration = 60 зарласан", () => {
    expect(Object.keys(routes)).toHaveLength(5);
    for (const [path, text] of Object.entries(routes)) expect(text, path).toMatch(/^export const maxDuration = 60;$/m);
  });
});

describe("1С HTTP-сервисийн анхдагч timeout, оролдлого", () => {
  it("Vercel: 60 сек × 1 оролдлого; ONEC_TIMEOUT_MS нь 60 сек-ээс хэтрэхгүй", () => {
    expect(defaultFetchOpts({ VERCEL: "1" })).toEqual({ timeoutMs: 60_000, retries: 1 });
    expect(defaultFetchOpts({ VERCEL: "1", ONEC_TIMEOUT_MS: "300000" })).toEqual({ timeoutMs: 60_000, retries: 1 });
    expect(defaultFetchOpts({ VERCEL: "1", ONEC_TIMEOUT_MS: "20000" })).toEqual({ timeoutMs: 20_000, retries: 1 });
  });
  it("Vercel биш (GitHub Actions, CLI): удаан 1С-д зориулж 5 минут × 3, ONEC_TIMEOUT_MS-ээр өөрчилнө", () => {
    expect(defaultFetchOpts({})).toEqual({ timeoutMs: 300_000, retries: 3 });
    expect(defaultFetchOpts({ ONEC_TIMEOUT_MS: "90000" })).toEqual({ timeoutMs: 90_000, retries: 3 });
  });
});
