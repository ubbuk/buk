import { isIP } from "node:net";

// Where the client address may come from. X-Forwarded-For and friends are plain request
// headers: anyone can send them, so they are believed ONLY when the deployment says a proxy
// we control sits in front of the app. Otherwise the address is unknown (null) and nothing
// keyed by IP can be enforced -- never a header value an attacker chose.
//
//   TRUSTED_PROXY unset   -> "vercel" when running on Vercel (VERCEL=1), else "none"
//   TRUSTED_PROXY=vercel  -> Vercel's edge sets the address headers itself and discards
//                            client-supplied copies, so they can be used as they come
//   TRUSTED_PROXY=hops:N  -> N reverse proxies of ours (nginx, a load balancer...) each append
//                            the address they saw to X-Forwarded-For; the client is the Nth
//                            entry from the RIGHT. Entries to its left are client-supplied
//                            and ignored. Fewer than N entries means the proxy chain is not
//                            what was configured, so nothing is trusted.
//   TRUSTED_PROXY=none    -> never trust any header
export type ProxyMode = { kind: "none" } | { kind: "vercel" } | { kind: "hops"; hops: number };

export function proxyMode(env: NodeJS.ProcessEnv = process.env): ProxyMode {
  const raw = env.TRUSTED_PROXY?.trim().toLowerCase();
  if (!raw) return env.VERCEL ? { kind: "vercel" } : { kind: "none" };
  if (raw === "vercel") return { kind: "vercel" };
  const m = /^hops:(\d{1,2})$/.exec(raw);
  if (m && Number(m[1]) >= 1) return { kind: "hops", hops: Number(m[1]) };
  return { kind: "none" }; // "none" and anything unrecognised: fail towards not trusting
}

type HeaderBag = Headers | Record<string, string | string[] | undefined> | null | undefined;

function header(headers: HeaderBag, name: string): string | null {
  if (!headers) return null;
  if (typeof (headers as Headers).get === "function") return (headers as Headers).get(name);
  const v = (headers as Record<string, string | string[] | undefined>)[name];
  return Array.isArray(v) ? v.join(",") : (v ?? null);
}

/** Expands an IPv6 address to its 8 hextets (handles "::" and a trailing IPv4 part). */
function hextets(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) {
    const p = v4[1].split(".").map(Number);
    s = s.slice(0, -v4[1].length) + ((p[0] << 8) | p[1]).toString(16) + ":" + ((p[2] << 8) | p[3]).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const all = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  const nums = all.map((h) => parseInt(h || "0", 16));
  return nums.length === 8 && nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? nums : null;
}

/**
 * The bucket identity of an address. IPv4 as is; IPv6 as its /64 (one customer typically owns a /64, so
 * rotating inside it must not give an attacker a fresh budget); IPv4-mapped IPv6 as the IPv4.
 */
export function normalizeIp(ip: string): string | null {
  const trimmed = ip.trim().replace(/^\[|\]$/g, "");
  const kind = isIP(trimmed);
  if (kind === 4) return trimmed;
  if (kind !== 6) return null;
  const h = hextets(trimmed);
  if (!h) return null;
  if (h.slice(0, 5).every((n) => n === 0) && h[5] === 0xffff) return `${h[6] >> 8}.${h[6] & 255}.${h[7] >> 8}.${h[7] & 255}`;
  return `v6:${h.slice(0, 4).map((n) => n.toString(16)).join(":")}`;
}

/** The client's address as far as this deployment can vouch for it, or null. */
export function clientIp(headers: HeaderBag, mode: ProxyMode = proxyMode()): string | null {
  if (mode.kind === "none") return null;
  if (mode.kind === "vercel") {
    const v = header(headers, "x-vercel-forwarded-for") ?? header(headers, "x-real-ip") ?? header(headers, "x-forwarded-for")?.split(",")[0] ?? null;
    return v ? normalizeIp(v) : null;
  }
  const chain = (header(headers, "x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (chain.length < mode.hops) return null;
  return normalizeIp(chain[chain.length - mode.hops]);
}
