// 1С OData хөтчийн тохиргоо. Нэвтрэлт зөвхөн сервер талын env-ээс уншигдана; хөтөч рүү хэзээ ч явахгүй.
// Олон жилийн бааз (ONEC_BASES, lib/onec/bases.ts): `year` өгвөл тухайн оны бааз; ONEC_BASES тохируулаагүй бол хуучин нэг баазын горим хэвээр.
import { multiYear, requireBase } from "@/lib/onec/bases";

export const MAX_PAGE_SIZE = 100; // $top-ийн дээд хязгаар
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE = 1000;
export const ODATA_TIMEOUT_MS = 30_000;
export const RATE_LIMIT_PER_MINUTE = 30;
export const CACHE_TTL_MS = 5 * 60_000;
export const METADATA_TTL_MS = 60 * 60_000;
export const DEFAULT_RANGE_DAYS = 30; // баримт, регистрт анхдагч шүүлтүүр
export const MAX_EXPAND = 6;

export type EnvLike = Record<string, string | undefined>;

/** Тохиргоо дутуу/буруу: хэрэглэгчид тодорхой мессеж өгөх, 1С руу хандахгүй */
export class OdataConfigError extends Error {}

export function odataBaseUrl(env: EnvLike = process.env, year?: string): string {
  if (multiYear(env)) return requireBase(year, "odata", env).odataUrl;
  const raw = env.ONEC_ODATA_BASE_URL?.trim();
  if (!raw) throw new OdataConfigError("ONEC_ODATA_BASE_URL тохируулаагүй байна");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OdataConfigError("ONEC_ODATA_BASE_URL буруу хаяг байна");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new OdataConfigError("ONEC_ODATA_BASE_URL http(s) байх ёстой");
  if (url.username || url.password) throw new OdataConfigError("ONEC_ODATA_BASE_URL дотор нэр/нууц үг бичихгүй (ONEC_ODATA_USER, ONEC_ODATA_PASSWORD-ийг ашиглана)");
  return url.toString().replace(/\/+$/, "");
}

export function odataCredentials(env: EnvLike = process.env, year?: string): { user: string; password: string } {
  if (multiYear(env)) {
    const b = requireBase(year, "odata", env);
    return { user: b.user, password: b.password };
  }
  const user = env.ONEC_ODATA_USER;
  const password = env.ONEC_ODATA_PASSWORD;
  if (!user || !password) throw new OdataConfigError("ONEC_ODATA_USER, ONEC_ODATA_PASSWORD тохируулаагүй байна");
  return { user, password };
}

/** Таслалаар, цэгтэй таслалаар эсвэл шинэ мөрөөр тусгаарласан жагсаалт. Хоосон мөр, давхардлыг хасна. */
export function parseList(raw: string | undefined): string[] {
  return [...new Set((raw ?? "").split(/[,;\n\r]+/).map((s) => s.trim()).filter(Boolean))];
}

/**
 * Хориотой объектын жагсаалт (цалин, хувийн мэдээлэл). Тохируулаагүй бол АЛДАА (fail-closed): жагсаалтгүйгээр
 * хөтөч ажиллахгүй. Бичлэг бүр объектын нэрэнд (том жижиг үсэг үл ялгах) агуулагдвал хориглоно.
 */
export function denyPatterns(env: EnvLike = process.env): string[] {
  const list = parseList(env.ONEC_ODATA_DENY);
  if (list.length === 0) throw new OdataConfigError("ONEC_ODATA_DENY тохируулаагүй байна: хориотой объектын жагсаалтгүйгээр хөтөч ажиллахгүй");
  return list;
}

/**
 * Цалин, хувь хүний объектууд: зөвхөн User.canViewPayroll === true хүн харна (role-оос үл хамаарна). Тохируулаагүй бол
 * АЛДАА (fail-closed): DENY-ээс PAYROLL руу шилжүүлсэн бичлэгүүд PAYROLL алга болсноор ил болохоос сэргийлнэ.
 */
export function payrollPatterns(env: EnvLike = process.env): string[] {
  const list = parseList(env.ONEC_ODATA_PAYROLL);
  if (list.length === 0) throw new OdataConfigError("ONEC_ODATA_PAYROLL тохируулаагүй байна: цалингийн объектын жагсаалтгүйгээр хөтөч ажиллахгүй");
  return list;
}

/** Няравт нээлттэй объектын нэрийн хэсгүүд. Хоосон бол нярав юу ч харахгүй. */
export function storekeeperAllowPatterns(env: EnvLike = process.env): string[] {
  return parseList(env.ONEC_ODATA_STOREKEEPER_ALLOW);
}
