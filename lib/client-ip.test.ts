import { describe, expect, it } from "vitest";
import { clientIp, normalizeIp, proxyMode } from "./client-ip";

describe("proxyMode", () => {
  it("defaults to vercel on Vercel and to no trust anywhere else", () => {
    expect(proxyMode({ VERCEL: "1" } as never)).toEqual({ kind: "vercel" });
    expect(proxyMode({} as never)).toEqual({ kind: "none" });
  });
  it("reads an explicit setting and fails towards not trusting", () => {
    expect(proxyMode({ TRUSTED_PROXY: "vercel" } as never)).toEqual({ kind: "vercel" });
    expect(proxyMode({ TRUSTED_PROXY: "HOPS:2" } as never)).toEqual({ kind: "hops", hops: 2 });
    expect(proxyMode({ TRUSTED_PROXY: "none", VERCEL: "1" } as never)).toEqual({ kind: "none" });
    for (const bad of ["hops:0", "hops:", "hops:x", "yes", "true", "1"]) expect(proxyMode({ TRUSTED_PROXY: bad } as never), bad).toEqual({ kind: "none" });
  });
});

describe("clientIp", () => {
  const h = (o: Record<string, string>) => new Headers(o);

  it("none: never believes a header", () => {
    expect(clientIp(h({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8" }), { kind: "none" })).toBeNull();
    expect(clientIp(null, { kind: "none" })).toBeNull();
  });

  it("vercel: the platform headers, in order of preference; garbage is not an address", () => {
    expect(clientIp(h({ "x-vercel-forwarded-for": "203.0.113.9", "x-forwarded-for": "1.1.1.1" }), { kind: "vercel" })).toBe("203.0.113.9");
    expect(clientIp(h({ "x-real-ip": "203.0.113.10" }), { kind: "vercel" })).toBe("203.0.113.10");
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.11, 10.0.0.1" }), { kind: "vercel" })).toBe("203.0.113.11");
    expect(clientIp(h({ "x-vercel-forwarded-for": "not-an-ip" }), { kind: "vercel" })).toBeNull();
    expect(clientIp(h({}), { kind: "vercel" })).toBeNull();
  });

  it("hops:N counts from the right, so entries a client prepends cannot change the answer", () => {
    expect(clientIp(h({ "x-forwarded-for": "198.51.100.1" }), { kind: "hops", hops: 1 })).toBe("198.51.100.1");
    // the client claims to be 9.9.9.9 and 8.8.8.8; our one proxy appended the real address last
    expect(clientIp(h({ "x-forwarded-for": "9.9.9.9, 8.8.8.8, 198.51.100.2" }), { kind: "hops", hops: 1 })).toBe("198.51.100.2");
    expect(clientIp(h({ "x-forwarded-for": "9.9.9.9, 198.51.100.3, 10.0.0.5" }), { kind: "hops", hops: 2 })).toBe("198.51.100.3");
    // fewer entries than configured proxies: the chain is not what we expected, trust nothing
    expect(clientIp(h({ "x-forwarded-for": "198.51.100.4" }), { kind: "hops", hops: 2 })).toBeNull();
    expect(clientIp(h({}), { kind: "hops", hops: 1 })).toBeNull();
    expect(clientIp(h({ "x-forwarded-for": "garbage" }), { kind: "hops", hops: 1 })).toBeNull();
  });

  it("accepts a plain header record (as NextAuth passes to authorize)", () => {
    expect(clientIp({ "x-forwarded-for": "1.1.1.1, 198.51.100.5" }, { kind: "hops", hops: 1 })).toBe("198.51.100.5");
    expect(clientIp({ "x-forwarded-for": ["1.1.1.1", "198.51.100.6"] }, { kind: "hops", hops: 1 })).toBe("198.51.100.6");
    expect(clientIp({}, { kind: "hops", hops: 1 })).toBeNull();
  });
});

describe("normalizeIp", () => {
  it("keeps IPv4, maps IPv4-in-IPv6 back, and buckets IPv6 by /64", () => {
    expect(normalizeIp("203.0.113.7")).toBe("203.0.113.7");
    expect(normalizeIp("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(normalizeIp("2001:db8::1")).toBe("v6:2001:db8:0:0");
    expect(normalizeIp("2001:0db8:0000:0000:ffff:0000:0000:0009")).toBe("v6:2001:db8:0:0");
    expect(normalizeIp("[2001:db8:1:2::5]")).toBe("v6:2001:db8:1:2");
    expect(normalizeIp("2001:db8:1:3::5")).not.toBe(normalizeIp("2001:db8:1:2::5"));
  });
  it("rejects what is not an address", () => {
    for (const bad of ["", "abc", "1.2.3", "1.2.3.4.5", "2001:::1", "999.1.1.1", "<script>"]) expect(normalizeIp(bad), bad).toBeNull();
  });
});
