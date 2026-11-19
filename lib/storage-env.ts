// Storage settings arrive from a host dashboard where a pasted value easily carries an invisible tab, newline, BOM or a
// pair of quotes ("\tauto" in S3_REGION produced `Region not accepted` and a 500 on every upload). Every S3_* / STORAGE_*
// value is read through here so such a paste cannot break signing or the endpoint.
const INVISIBLE_EDGE = /^[\s\u200b-\u200d\u2060\ufeff]+|[\s\u200b-\u200d\u2060\ufeff]+$/g;

export class StorageConfigError extends Error {}

export function storageEnv(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  let v = env[name];
  if (v === undefined) return undefined;
  v = v.replace(INVISIBLE_EDGE, "");
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) v = v.slice(1, -1).replace(INVISIBLE_EDGE, "");
  return v === "" ? undefined : v;
}

/** The region name, or a reason (no value) why it cannot be one. */
export function validRegion(region: string): boolean {
  return /^[a-z0-9-]{2,30}$/.test(region);
}

/** The endpoint without a trailing slash, or null when it is not an https URL with no path (a bucket name does not belong in it). */
export function normalizeEndpoint(endpoint: string): string | null {
  try {
    const u = new URL(endpoint);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.pathname !== "/" && u.pathname !== "") return null;
    return u.origin;
  } catch {
    return null;
  }
}
