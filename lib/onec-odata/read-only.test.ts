/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";

// Аюулгүй байдлын баталгаа #1: 1С OData модуль ЗӨВХӨН УНШДАГ. Эх кодонд бичих функц, бичих HTTP метод байхгүй.
// lib/onec-odata, app/api/onec-odata, app/(app)/onec, components/onec-odata доторх бүх эх файлыг (тестээс бусад) шалгана.
const sources = {
  ...(import.meta.glob("/lib/onec-odata/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>),
  ...(import.meta.glob("/app/api/onec-odata/**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>),
  ...(import.meta.glob("/app/(app)/onec/**/*.tsx", { query: "?raw", import: "default", eager: true }) as Record<string, string>),
  ...(import.meta.glob("/components/onec-odata/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<string, string>),
};
const files = Object.entries(sources).filter(([path]) => !path.endsWith(".test.ts"));
const routeFiles = files.filter(([path]) => path.startsWith("/app/api/onec-odata/"));

// Тайлбарыг хасаад кодыг шалгана (тайлбарт "POST хийхгүй" гэх мэт бичиж болно)
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("1С OData модуль: зөвхөн унших", () => {
  it("шалгах файлууд олдсон", () => {
    expect(files.length).toBeGreaterThan(8);
    expect(routeFiles.length).toBe(2);
  });

  it.each(files.map(([p]) => p))("%s: бичих HTTP метод, бичих функц байхгүй", (path) => {
    const text = code(sources[path]);
    expect(text, "POST/PUT/PATCH/DELETE/MERGE метод").not.toMatch(/\b(POST|PUT|PATCH|DELETE|MERGE)\b/);
    expect(text, "fetch-ийн method").not.toMatch(/method\s*:\s*["'`](?!GET["'`])/i);
    expect(text, "бичих нэртэй функц").not.toMatch(/\b(post|put|patch|delete|merge|write|update|create|insert|save)(Odata|OData|1C|OneC|Onec)\w*\s*[(=]/i);
    expect(text, "XMLHttpRequest/axios/got зэрэг өөр HTTP клиент").not.toMatch(/XMLHttpRequest|axios|\bgot\(|node-fetch|\.request\(/);
    expect(text, "body-той хүсэлт").not.toMatch(/\bbody\s*:/);
  });

  it("route файл бүр зөвхөн GET экспортолно", async () => {
    for (const [path] of routeFiles) {
      const exported = [...code(sources[path]).matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g)].map((m) => m[1]);
      const handlers = exported.filter((n) => /^[A-Z]+$/.test(n));
      expect(handlers, path).toEqual(["GET"]);
    }
  });

  it("1С руу гарах ганц fetch нь method: GET-ийг тодорхой заасан, зөвхөн client.ts дотор", () => {
    const withFetch = files.filter(([, t]) => /\bfetch\s*\(/.test(code(t)));
    // OnecBrowser.tsx нь ERP-ийн өөрийн API-г дууддаг (1С-ийг шууд биш)
    expect(withFetch.map(([p]) => p).sort()).toEqual(["/components/onec-odata/OnecBrowser.tsx", "/lib/onec-odata/client.ts"]);
    expect(code(sources["/lib/onec-odata/client.ts"])).toMatch(/method:\s*"GET"/);
    expect(code(sources["/components/onec-odata/OnecBrowser.tsx"])).not.toMatch(/method\s*:/);
  });

  it("нэвтрэлтийн env нь зөвхөн сервер талын кодонд уншигдана (хөтөч рүү очих файлд байхгүй)", () => {
    for (const [path, text] of files) {
      if (/^\/(components|app\/\(app\))\//.test(path)) expect(text, path).not.toMatch(/ONEC_ODATA_(USER|PASSWORD)|process\.env/);
    }
    const readers = files.filter(([, t]) => /ONEC_ODATA_(USER|PASSWORD)/.test(code(t))).map(([p]) => p);
    expect(readers).toEqual(["/lib/onec-odata/config.ts"]);
  });

  it("нууц утга эх кодонд бичигдээгүй (URL дотор нэр:нууц, Authorization-д шууд утга)", () => {
    for (const [path, text] of files) {
      expect(text, path).not.toMatch(/https?:\/\/[^\s/"'`]+:[^\s@"'`]+@/);
      expect(text, path).not.toMatch(/Basic\s+[A-Za-z0-9+/=]{12,}/);
    }
  });
});
