// 1С OData руу ЗӨВХӨН УНШИХ (HTTP GET) хандалт. Энэ модульд бичих (POST/PATCH/PUT/DELETE) функц байхгүй бөгөөд
// байж ч болохгүй: read-only.test.ts үүнийг баталгаажуулна.
// Нэвтрэлт (ONEC_ODATA_USER/PASSWORD) зөвхөн энд, сервер дээр уншигдана. Алдааны мессежид URL, нэр, нууц үг орохгүй.
import { BaseConfigError } from "@/lib/onec/bases";
import { logOnecCall } from "@/lib/onec/timing";
import { activeOneCYear } from "@/lib/onec/year-context";
import { OdataConfigError, ODATA_TIMEOUT_MS, odataBaseUrl, odataCredentials } from "./config";

export class OdataError extends Error {
  constructor(
    /** хэрэглэгчид буцаах HTTP төлөв */
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

const MAX_BODY_BYTES = 25 * 1024 * 1024;

// Кирилл нэртэй хэрэглэгч зөв нэвтрэхийн тулд UTF-8-аар кодлоно
function authHeader(year?: string): string {
  const { user, password } = odataCredentials(process.env, year);
  return `Basic ${Buffer.from(`${user}:${password}`, "utf8").toString("base64")}`;
}

/**
 * `path` нь сервер өөрөө бүтээсэн (query.ts) харьцангуй зам: "$metadata" эсвэл "<объект>?$top=..".
 * Хэрэглэгчийн текстийг энд шууд оруулахгүй. Үргэлж GET.
 */
export async function odataGet(path: string, accept: "json" | "xml", opts: { timeoutMs?: number } = {}): Promise<string> {
  let base: string;
  let auth: string;
  try {
    const year = activeOneCYear(); // ONEC_BASES: сонгосон оны бааз (lib/onec/year-context.ts)
    base = odataBaseUrl(process.env, year);
    auth = authHeader(year);
  } catch (e) {
    if (e instanceof OdataConfigError || e instanceof BaseConfigError) throw new OdataError(503, e.message);
    throw e;
  }

  let res: Response;
  const startedAt = Date.now();
  try {
    res = await fetch(`${base}/${path}`, {
      method: "GET",
      headers: { Authorization: auth, Accept: accept === "json" ? "application/json" : "application/xml" },
      signal: AbortSignal.timeout(opts.timeoutMs ?? ODATA_TIMEOUT_MS), // удаан тооцоолол (Balance) зөвхөн ар талын ажилд урт хугацаатай
      redirect: "error", // нэвтрэлтийг өөр хаяг руу дамжуулахгүй
      cache: "no-store",
    });
  } catch (e) {
    const timeout = e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError");
    logOnecCall("odata", path, startedAt, timeout ? "timeout" : "error");
    throw new OdataError(timeout ? 504 : 502, timeout ? `1С хугацаандаа хариу өгсөнгүй (${Math.round((opts.timeoutMs ?? ODATA_TIMEOUT_MS) / 1000)} сек)` : "1С-тэй холбогдож чадсангүй");
  }

  if (res.status === 401 || res.status === 403) throw new OdataError(502, "1С-ийн техникийн хэрэглэгчийн нэвтрэлт буруу эсвэл эрхгүй байна");
  if (!res.ok) throw new OdataError(502, `1С алдаа буцаалаа (${res.status})`);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) throw new OdataError(502, "1С-ийн хариу хэт том байна");
  const text = await res.text();
  logOnecCall("odata", path, startedAt, res.status); // бие нь бүтнээр ирсэн хүртэлх хугацаа
  if (text.length > MAX_BODY_BYTES) throw new OdataError(502, "1С-ийн хариу хэт том байна");
  return text;
}
