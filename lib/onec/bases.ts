// 1С бааз жил бүр солигддог (BUK_NBB_2026, BUK_NBB_2027 ...): ERP олон жилийн баазтай ажиллана.
//
// ONEC_BASES (JSON): {"2026":"http://host/BUK_NBB_2026","2027":"http://host/BUK_NBB_2027"}. Утга нь хаяг, эсвэл жил тусдаа нэвтрэлттэй бол
// {"url":"http://host/BUK_NBB_2027","user":"...","password":"..."} хэлбэртэй байж болно (хоёр хэлбэрийг хольж болно). Нэр, нууц үг
// заагаагүй бол нийтлэг ONEC_ODATA_USER/PASSWORD (HTTP-сервисэд ONEC_USER/PASSWORD)-ийг ашиглана.
// Хаяг нь мэдээллийн сангийн үндэс (".../BUK_NBB_2026"); ".../odata/standard.odata" залгасан ч болно.
//
// Нийцтэй байдал: ONEC_BASES тохируулаагүй бол хуучин нэг баазын тохиргоо (ONEC_ODATA_BASE_URL, ONEC_BASE_URL) ЯГ ӨМНӨХИЙН адил бүх
// жилд ажиллана. ONEC_BASES тохируулсан бол ЗӨВХӨН жагсаалтад байгаа жилүүд ажиллана (тухайн оны бааз байхгүй бол «Энэ оны 1С бааз
// холбогдоогүй»): өөр оны өгөгдлийг буруу баазаас татахгүйн тулд хуучин нэг баазыг орлуулж ашиглахгүй.
// Он нь сонгосон сарын он (ym.slice(0,4)), эсвэл татаж буй огнооны он.
import { currentMonth } from "./dates";

type EnvLike = Record<string, string | undefined>;

export const BASE_MISSING_MESSAGE = "Энэ оны 1С бааз холбогдоогүй";

/** Тохиргоо дутуу/буруу (хэрэглэгчид ойлгомжтой мессеж). Утга, нууц үг мессежид орохгүй. */
export class BaseConfigError extends Error {}
/** Тухайн оны бааз тохируулагдаагүй */
export class BaseNotConfiguredError extends BaseConfigError {
  constructor(readonly year: string) {
    super(BASE_MISSING_MESSAGE);
  }
}

export interface ResolvedBase {
  year: string;
  /** мэдээллийн сангийн үндэс, жишээ нь http://host/BUK_NBB_2026 (/hs/dash энд залгагдана) */
  baseUrl: string;
  /** OData-ийн үндэс: <baseUrl>/odata/standard.odata */
  odataUrl: string;
  user: string;
  password: string;
}

const ODATA_SUFFIX = /\/odata\/standard\.odata\/?$/i;

/** Хаягийг шалгаж, үндэс рүү хөрвүүлнэ (залгавар, төгсгөлийн "/" хасна). Алдаа бол null. */
export function normalizeBaseUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
  return url.toString().replace(ODATA_SUFFIX, "").replace(/\/+$/, "");
}

interface Entry {
  baseUrl: string;
  user?: string;
  password?: string;
}

/** ONEC_BASES-ийг задлана. Тохируулаагүй бол null (хуучин нэг баазын горим). */
export function parseBases(env: EnvLike = process.env): Map<string, Entry> | null {
  const raw = env.ONEC_BASES?.trim();
  if (!raw) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new BaseConfigError('ONEC_BASES буруу JSON байна. Жишээ: {"2026":"http://host/BUK_NBB_2026"}');
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new BaseConfigError("ONEC_BASES нь {жил: хаяг} хэлбэртэй JSON объект байх ёстой");
  const out = new Map<string, Entry>();
  for (const [year, value] of Object.entries(json as Record<string, unknown>)) {
    if (!/^\d{4}$/.test(year)) throw new BaseConfigError(`ONEC_BASES: "${year}" нь 4 оронтой он биш байна`);
    const obj = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
    const baseUrl = normalizeBaseUrl(obj ? (obj.url ?? obj.baseUrl) : value);
    if (!baseUrl) throw new BaseConfigError(`ONEC_BASES: ${year} оны хаяг буруу байна (http(s), нэр нууц үггүй)`);
    out.set(year, { baseUrl, user: typeof obj?.user === "string" && obj.user ? obj.user : undefined, password: typeof obj?.password === "string" && obj.password ? obj.password : undefined });
  }
  return out;
}

/** Олон жилийн горим (ONEC_BASES тохируулсан) эсэх */
export const multiYear = (env: EnvLike = process.env): boolean => !!env.ONEC_BASES?.trim();

/** Жил заагаагүй үед (хөтөч, нийтлэг дуудлага) одоогийн он (Улаанбаатарын цагаар) */
export const defaultYear = (): string => currentMonth().slice(0, 4);

/** Тохируулагдсан жилүүд (олон жилийн горимд). Хуучин горимд хоосон. */
export const configuredYears = (env: EnvLike = process.env): string[] => [...(parseBases(env)?.keys() ?? [])].sort();

/**
 * Тухайн оны баазын хаяг, нэвтрэлт. Тохируулаагүй бол null.
 * `service`: "odata" (ONEC_ODATA_USER/PASSWORD) эсвэл "hub" (/hs/dash: ONEC_USER/PASSWORD, байхгүй бол ONEC_ODATA_*).
 */
export function resolveBase(year: string | undefined, service: "odata" | "hub", env: EnvLike = process.env): ResolvedBase | null {
  const y = year && /^\d{4}$/.test(year) ? year : defaultYear();
  const bases = parseBases(env);
  let baseUrl: string | null;
  let own: Entry | undefined;
  if (bases) {
    own = bases.get(y);
    baseUrl = own?.baseUrl ?? null;
  } else if (service === "hub") {
    baseUrl = normalizeBaseUrl(env.ONEC_BASE_URL) ?? normalizeBaseUrl(env.ONEC_ODATA_BASE_URL);
  } else {
    baseUrl = normalizeBaseUrl(env.ONEC_ODATA_BASE_URL);
  }
  if (!baseUrl) return null;
  const user = own?.user ?? (service === "hub" ? env.ONEC_USER || env.ONEC_ODATA_USER : env.ONEC_ODATA_USER);
  const password = own?.password ?? (service === "hub" ? env.ONEC_PASSWORD || env.ONEC_ODATA_PASSWORD : env.ONEC_ODATA_PASSWORD);
  if (!user || !password) throw new BaseConfigError(service === "hub" ? "ONEC_USER, ONEC_PASSWORD (эсвэл ONEC_ODATA_USER, ONEC_ODATA_PASSWORD) тохируулаагүй байна" : "ONEC_ODATA_USER, ONEC_ODATA_PASSWORD тохируулаагүй байна");
  return { year: y, baseUrl, odataUrl: `${baseUrl}/odata/standard.odata`, user, password };
}

/** Бааз байхгүй бол BaseNotConfiguredError */
export function requireBase(year: string | undefined, service: "odata" | "hub", env: EnvLike = process.env): ResolvedBase {
  const b = resolveBase(year, service, env);
  if (!b) throw new BaseNotConfiguredError(year && /^\d{4}$/.test(year) ? year : defaultYear());
  return b;
}

/** Тухайн оны бааз (OData эсвэл HTTP-сервис) тохируулагдсан эсэх, нэвтрэлт шалгахгүйгээр */
export function isBaseConfigured(year: string, env: EnvLike = process.env): boolean {
  const bases = parseBases(env);
  if (bases) return bases.has(year);
  return !!(normalizeBaseUrl(env.ONEC_ODATA_BASE_URL) || normalizeBaseUrl(env.ONEC_BASE_URL));
}

/**
 * Жилийн эцсийн хаалтын засвар (1-2-р сард өмнөх оны бааз руу бичилт орно): тухайн өдөр өмнөх оны 12-р сарыг дахин татах төлөвлөгөө.
 * 3-р сараас хойш null.
 */
export function closingTargets(today: string): { months: string[]; stockDate: string; receivablesMonth: string } | null {
  const month = Number(today.slice(5, 7));
  if (month > 2) return null;
  const prev = String(Number(today.slice(0, 4)) - 1);
  return { months: [`${prev}-12`], stockDate: `${prev}-12-31`, receivablesMonth: `${prev}-12` };
}
