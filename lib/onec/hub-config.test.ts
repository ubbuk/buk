import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchStock, hubConfig } from "./client";

const ODATA = { ONEC_ODATA_BASE_URL: "http://1c.test/BASE/odata/standard.odata/", ONEC_ODATA_USER: "odata_user", ONEC_ODATA_PASSWORD: "odata-pw" };

afterEach(() => vi.unstubAllGlobals());

describe("1С HTTP-сервисийн тохиргоо: «Шинэчлэх» товч env нэр зөрсөнөөс унадаг байсан", () => {
  it("ONEC_BASE_URL, ONEC_USER, ONEC_PASSWORD өгсөн бол тэдгээрийг ашиглана", () => {
    expect(hubConfig({ ONEC_BASE_URL: "http://hub.test/b", ONEC_USER: "u", ONEC_PASSWORD: "p", ...ODATA })).toEqual({ baseUrl: "http://hub.test/b", user: "u", password: "p" });
  });

  it("зөвхөн ONEC_ODATA_* байвал хаяг нь «/odata/standard.odata»-ийн өмнөх хэсэг, нэр, нууц үг нь OData-ийнх", () => {
    expect(hubConfig(ODATA)).toEqual({ baseUrl: "http://1c.test/BASE", user: "odata_user", password: "odata-pw" });
    expect(hubConfig({ ...ODATA, ONEC_ODATA_BASE_URL: "http://1c.test/BASE/odata/standard.odata" }).baseUrl).toBe("http://1c.test/BASE");
  });

  it("хоёулаа байхгүй бол ямар нэр дутууг хэлсэн ойлгомжтой алдаа (утгагүй)", () => {
    expect(() => hubConfig({})).toThrow(/ONEC_BASE_URL/);
    expect(() => hubConfig({ ONEC_BASE_URL: "http://hub.test/b" })).toThrow(/ONEC_USER/);
  });

  it("татаалт OData-ийн тохиргоогоор үнэхээр явна (GET, /hs/dash/stock, Basic нэвтрэлт)", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ rows: [], count: 0 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const saved = { ...process.env };
    for (const k of ["ONEC_BASE_URL", "ONEC_USER", "ONEC_PASSWORD"]) delete process.env[k];
    Object.assign(process.env, ODATA);
    try {
      await fetchStock("2026-11-13", { timeoutMs: 5000, retries: 1 });
    } finally {
      for (const k of Object.keys(ODATA)) delete process.env[k];
      Object.assign(process.env, saved);
    }
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://1c.test/BASE/hs/dash/stock?asof=2026-11-13");
    expect(init.headers).toMatchObject({ Authorization: `Basic ${Buffer.from("odata_user:odata-pw").toString("base64")}` });
    expect(init.method).toBeUndefined(); // GET (анхдагч)
  });
});
