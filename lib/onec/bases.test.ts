import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { odataGet, OdataError } from "@/lib/onec-odata/client";
import { odataBaseUrl, odataCredentials } from "@/lib/onec-odata/config";
import { BASE_MISSING_MESSAGE, BaseConfigError, BaseNotConfiguredError, closingTargets, isBaseConfigured, normalizeBaseUrl, parseBases, requireBase, resolveBase } from "./bases";
import { fetchStock, hubConfig } from "./client";
import { withOneCYear } from "./year-context";

const BASES = JSON.stringify({ "2026": "http://1c.test/BUK_NBB_2026", "2027": { url: "http://1c.test/BUK_NBB_2027/odata/standard.odata/", user: "user27", password: "pw27" } });
const COMMON = { ONEC_ODATA_USER: "common_user", ONEC_ODATA_PASSWORD: "common_pw", ONEC_USER: "hub_user", ONEC_PASSWORD: "hub_pw" };

describe("ONEC_BASES: он бүрийн бааз", () => {
  it("хаяг, залгавар, төгсгөлийн «/»-ийг үндэс болгож хэвийн болгоно; нэр нууц үгтэй, http(s) биш хаягийг татгалзана", () => {
    expect(normalizeBaseUrl("http://h/BUK_NBB_2026/")).toBe("http://h/BUK_NBB_2026");
    expect(normalizeBaseUrl("http://h/BUK_NBB_2026/odata/standard.odata")).toBe("http://h/BUK_NBB_2026");
    expect(normalizeBaseUrl("http://u:p@h/b")).toBeNull();
    expect(normalizeBaseUrl("ftp://h/b")).toBeNull();
    expect(normalizeBaseUrl("")).toBeNull();
  });

  it("зөвхөн жагсаалтад байгаа жил; жил бүрийн нэвтрэлт тусдаа байж болно, үгүй бол нийтлэг", () => {
    const env = { ONEC_BASES: BASES, ...COMMON };
    expect(resolveBase("2026", "odata", env)).toMatchObject({ baseUrl: "http://1c.test/BUK_NBB_2026", odataUrl: "http://1c.test/BUK_NBB_2026/odata/standard.odata", user: "common_user", password: "common_pw" });
    expect(resolveBase("2027", "odata", env)).toMatchObject({ baseUrl: "http://1c.test/BUK_NBB_2027", user: "user27", password: "pw27" });
    expect(resolveBase("2026", "hub", env)).toMatchObject({ user: "hub_user", password: "hub_pw" });
    expect(resolveBase("2027", "hub", env)).toMatchObject({ user: "user27" });
    expect(resolveBase("2025", "odata", env)).toBeNull();
    expect(isBaseConfigured("2027", env)).toBe(true);
    expect(isBaseConfigured("2025", env)).toBe(false);
  });

  it("тохируулаагүй оны бааз: «Энэ оны 1С бааз холбогдоогүй»", () => {
    expect(() => requireBase("2025", "odata", { ONEC_BASES: BASES, ...COMMON })).toThrow(BaseNotConfiguredError);
    expect(() => requireBase("2025", "odata", { ONEC_BASES: BASES, ...COMMON })).toThrow(BASE_MISSING_MESSAGE);
  });

  it("буруу JSON, буруу жил, буруу хаяг: ойлгомжтой алдаа, утга, нууц үг мессежид орохгүй", () => {
    for (const bad of ["not json", "[]", '{"26":"http://h/b"}', '{"2026":"ftp://secret-host/b"}', '{"2026":{"user":"u","password":"supersecret"}}']) {
      const err = (() => {
        try {
          parseBases({ ONEC_BASES: bad });
        } catch (e) {
          return e as Error;
        }
      })();
      expect(err, bad).toBeInstanceOf(BaseConfigError);
      expect(err!.message).not.toMatch(/supersecret|secret-host/);
    }
  });

  it("хуучин нэг баазын тохиргоо (ONEC_BASES байхгүй) бүх жилд ЯГ ӨМНӨХИЙН адил ажиллана", () => {
    const env = { ONEC_ODATA_BASE_URL: "http://1c.test/BASE/odata/standard.odata/", ONEC_ODATA_USER: "u", ONEC_ODATA_PASSWORD: "p" };
    expect(resolveBase("2026", "odata", env)?.odataUrl).toBe("http://1c.test/BASE/odata/standard.odata");
    expect(resolveBase("2031", "odata", env)?.odataUrl).toBe("http://1c.test/BASE/odata/standard.odata");
    expect(resolveBase("2026", "hub", env)).toMatchObject({ baseUrl: "http://1c.test/BASE", user: "u", password: "p" });
    expect(isBaseConfigured("2031", env)).toBe(true);
    expect(odataBaseUrl(env)).toBe("http://1c.test/BASE/odata/standard.odata");
    expect(odataCredentials(env)).toEqual({ user: "u", password: "p" });
    expect(hubConfig(env)).toEqual({ baseUrl: "http://1c.test/BASE", user: "u", password: "p" });
  });

  it("ONEC_BASES тохируулсан бол хуучин нэг баазыг орлуулж ашиглахгүй (буруу оны өгөгдөл татагдахгүй)", () => {
    const env = { ONEC_BASES: '{"2027":"http://1c.test/BUK_NBB_2027"}', ONEC_ODATA_BASE_URL: "http://1c.test/OLD/odata/standard.odata", ...COMMON };
    expect(resolveBase("2026", "odata", env)).toBeNull();
    expect(() => odataBaseUrl(env, "2026")).toThrow(BASE_MISSING_MESSAGE);
    expect(() => hubConfig(env, "2026")).toThrow(BASE_MISSING_MESSAGE);
    expect(odataBaseUrl(env, "2027")).toBe("http://1c.test/BUK_NBB_2027/odata/standard.odata");
    expect(hubConfig(env, "2027").baseUrl).toBe("http://1c.test/BUK_NBB_2027");
  });

  it("жилийн эцсийн хаалтын засвар: зөвхөн 1-2-р сард өмнөх оны 12-р сар", () => {
    expect(closingTargets("2027-01-15")).toEqual({ months: ["2026-12"], stockDate: "2026-12-31", receivablesMonth: "2026-12" });
    expect(closingTargets("2027-02-28")?.months).toEqual(["2026-12"]);
    expect(closingTargets("2027-03-01")).toBeNull();
    expect(closingTargets("2026-11-13")).toBeNull();
  });
});

describe("1С дуудлага сонгосон оны баазад очно (fetch дуурайлгасан, зөвхөн GET)", () => {
  const calls: { url: string; auth: string; method?: string }[] = [];
  const saved = { ...process.env };

  beforeEach(() => {
    calls.length = 0;
    for (const k of Object.keys(process.env)) if (k.startsWith("ONEC_")) delete process.env[k];
    Object.assign(process.env, { ONEC_BASES: BASES, ...COMMON });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, auth: String((init.headers as Record<string, string>).Authorization), method: init.method });
        return new Response(JSON.stringify({ value: [], rows: [] }), { status: 200 });
      })
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of Object.keys(process.env)) if (k.startsWith("ONEC_")) delete process.env[k];
    Object.assign(process.env, saved);
  });
  const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString("base64")}`;

  it("OData: контекстийн оны бааз, оны нэвтрэлтээр; контекстгүй бол одоогийн он", async () => {
    await withOneCYear("2027", () => odataGet("Catalog_X?$top=1", "json"));
    await withOneCYear("2026", () => odataGet("Catalog_X?$top=1", "json"));
    expect(calls[0]).toMatchObject({ url: "http://1c.test/BUK_NBB_2027/odata/standard.odata/Catalog_X?$top=1", auth: basic("user27", "pw27"), method: "GET" });
    expect(calls[1]).toMatchObject({ url: "http://1c.test/BUK_NBB_2026/odata/standard.odata/Catalog_X?$top=1", auth: basic("common_user", "common_pw") });
  });

  it("OData: бааз тохируулаагүй оны хувьд 1С руу огт хандахгүй, 503 «Энэ оны 1С бааз холбогдоогүй»", async () => {
    const err = await withOneCYear("2025", () => odataGet("Catalog_X", "json")).catch((e) => e);
    expect(err).toBeInstanceOf(OdataError);
    expect(err.status).toBe(503);
    expect(err.message).toBe(BASE_MISSING_MESSAGE);
    expect(calls).toHaveLength(0);
  });

  it("HTTP-сервис (/hs/dash): огнооны оны бааз, нэвтрэлт (asof, from)", async () => {
    await fetchStock("2027-01-05", { timeoutMs: 5000, retries: 1 });
    await fetchStock("2026-12-31", { timeoutMs: 5000, retries: 1 });
    expect(calls[0].url).toBe("http://1c.test/BUK_NBB_2027/hs/dash/stock?asof=2027-01-05");
    expect(calls[0].auth).toBe(basic("user27", "pw27"));
    expect(calls[1].url).toBe("http://1c.test/BUK_NBB_2026/hs/dash/stock?asof=2026-12-31");
    expect(calls[1].auth).toBe(basic("hub_user", "hub_pw"));
    await expect(fetchStock("2025-12-31", { timeoutMs: 5000, retries: 1 })).rejects.toThrow(BASE_MISSING_MESSAGE);
    expect(calls).toHaveLength(2);
  });
});
