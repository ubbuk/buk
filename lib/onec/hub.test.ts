import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_RANGE_DAYS, generatedNow, hubKeyMatches, parseAsof, parseRange, requireHubKey } from "./hub";

// Бодит түлхүүр биш: тестэд зориулсан 40 тэмдэгт
const KEY = "test-only-key-0123456789-abcdefghijklmnop";

describe("hubKeyMatches", () => {
  it("accepts exactly the configured key as a Bearer token", () => {
    expect(hubKeyMatches(`Bearer ${KEY}`, KEY)).toBe(true);
    expect(hubKeyMatches(`bearer ${KEY}`, KEY)).toBe(true);
  });

  it("refuses a missing, malformed or wrong credential", () => {
    for (const header of [null, "", KEY, `Basic ${KEY}`, `Bearer`, `Bearer ${KEY}x`, `Bearer ${KEY.slice(0, -1)}`, `Bearer wrong`, `Bearer ${KEY} extra`]) {
      expect(hubKeyMatches(header, KEY), String(header)).toBe(false);
    }
  });

  it("refuses everything when the key is not configured or shorter than 32 characters", () => {
    expect(hubKeyMatches(`Bearer ${KEY}`, undefined)).toBe(false);
    expect(hubKeyMatches(`Bearer ${KEY}`, "")).toBe(false);
    expect(hubKeyMatches("Bearer short", "short")).toBe(false);
  });
});

describe("requireHubKey", () => {
  afterEach(() => vi.unstubAllEnvs());
  const req = (auth?: string) => new Request("http://x/api/v1/onec/stock", { headers: auth ? { authorization: auth } : {} });

  it("answers 401 with no-store when there is no or a wrong key, and lets the right key through", async () => {
    vi.stubEnv("ONEC_HUB_API_KEY", KEY);
    for (const r of [req(), req("Bearer nope"), req(`Basic ${KEY}`)]) {
      const res = requireHubKey(r);
      expect(res?.status).toBe(401);
      expect(res?.headers.get("Cache-Control")).toBe("no-store");
      expect(res?.headers.get("WWW-Authenticate")).toContain("Bearer");
    }
    expect(requireHubKey(req(`Bearer ${KEY}`))).toBeNull();
  });

  it("fails closed when the server has no key", () => {
    vi.stubEnv("ONEC_HUB_API_KEY", "");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(requireHubKey(req(`Bearer ${KEY}`))?.status).toBe(401);
  });
});

describe("parameters", () => {
  const sp = (q: string) => new URLSearchParams(q);

  it("asof is optional but must be a real yyyy-MM-dd date", async () => {
    expect(parseAsof(sp(""))).toEqual({ value: null });
    expect(parseAsof(sp("asof=2026-11-11"))).toEqual({ value: "2026-11-11" });
    for (const bad of ["asof=2026-13-45", "asof=11/11/2026", "asof=2026-11-11T00:00:00", "asof=abc"]) {
      const r = parseAsof(sp(bad));
      expect("error" in r, bad).toBe(true);
      if ("error" in r) {
        expect(r.error.status).toBe(400);
        expect(await r.error.json()).toEqual({ error: "asof must be yyyy-MM-dd" });
      }
    }
  });

  it("from and to are both required, ordered and bounded", async () => {
    expect(parseRange(sp("from=2026-11-01&to=2026-11-30"))).toEqual({ value: { from: "2026-11-01", to: "2026-11-30" } });
    for (const bad of ["", "from=2026-11-01", "to=2026-11-30", "from=2026-11-01&to=2026-02-30", "from=x&to=y", "from=2026-11-30&to=2026-11-01", `from=2025-01-01&to=2026-11-30`]) {
      const r = parseRange(sp(bad));
      expect("error" in r, bad).toBe(true);
      if ("error" in r) expect(r.error.status).toBe(400);
    }
    const msg = parseRange(sp("from=2026-11-01"));
    if ("error" in msg) expect(await msg.error.json()).toEqual({ error: "from and to must be yyyy-MM-dd" });
    expect(MAX_RANGE_DAYS).toBeGreaterThanOrEqual(366);
  });

  it("generated looks like the 1C stamp", () => {
    expect(generatedNow()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });
});
