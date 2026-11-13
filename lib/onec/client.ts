import { logOnecCall } from "./timing";

// 1С HTTP-сервис (/hs/dash/*) рүү хандах клиент. Бүх endpoint { rows, count, generated } хэлбэртэй хариу өгнө.

export type SalesRow = {
  date: string;
  org: string;
  item_code: string;
  item: string;
  unit: string;
  qty: number;
  amount: number;
  vat: number;
  cost: number;
  client_code: string;
  client: string;
  client_reg: string;
  dept: string;
  doc: string;
  row_type: string;
};

export type PlRow = {
  month: string;
  item_code: string;
  item: string;
  account: string;
  group: string;
  side: string;
  amount: number;
};

export type StockRow = {
  org: string;
  warehouse_code: string;
  warehouse: string;
  item_code: string;
  item: string;
  unit: string;
  account: string;
  qty: number;
  amount: number;
};

export type CashRow = {
  date: string;
  account: string;
  client_code: string;
  client: string;
  item_code: string;
  item: string;
  inflow: number;
  outflow: number;
  memo: string;
  doc: string;
};

export type ReceivableRow = {
  type: string;
  client_code: string;
  client: string;
  doc: string;
  doc_date: string;
  due: string;
  amount: number;
  balance: number;
  overdue_days: number;
};

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`.env дотор ${name} тохируулаагүй байна`);
  return v;
}

// Кирилл нэртэй хэрэглэгч зөв нэвтрэхийн тулд UTF-8-аар кодлоно
function authHeader(): string {
  const token = Buffer.from(`${env("ONEC_USER")}:${env("ONEC_PASSWORD")}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** timeoutMs/retries: интерактив дуудлагад богино (жишээ нь 10 сек, 1 оролдлого); өгөхгүй бол sync-ийн удаан дүрэм */
export interface FetchOpts {
  timeoutMs?: number;
  retries?: number;
}

/**
 * Анхдагч timeout, оролдлого. sync (CLI, GitHub Actions) дээр 1С удаан тул 5 минут × 3 оролдлого (ONEC_TIMEOUT_MS-ээр өөрчилнө).
 * Vercel дээр функц хэдэн секундээр хязгаартай тул 60 сек × 1 оролдлого (ONEC_TIMEOUT_MS нь 60 сек-ээс хэтэрч болохгүй).
 */
export function defaultFetchOpts(env: Record<string, string | undefined> = process.env): Required<FetchOpts> {
  const configured = Number(env.ONEC_TIMEOUT_MS);
  if (env.VERCEL) return { timeoutMs: configured > 0 ? Math.min(configured, 60_000) : 60_000, retries: 1 }; // функцийн maxDuration (60 сек)-ээс хэтрэхгүй
  return { timeoutMs: configured > 0 ? configured : 300_000, retries: 3 };
}

async function getRows<T>(path: string, params: Record<string, string>, opts: FetchOpts = {}): Promise<T[]> {
  const base = env("ONEC_BASE_URL").replace(/\/+$/, "");
  const url = `${base}${path}?${new URLSearchParams(params)}`;
  const defaults = defaultFetchOpts();
  const timeoutMs = opts.timeoutMs ?? defaults.timeoutMs;
  const retries = opts.retries ?? defaults.retries;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const startedAt = Date.now();
    try {
      const res = await fetch(url, {
        headers: { Authorization: authHeader(), Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      logOnecCall("hub", path, startedAt, res.status);
      if (res.status === 401) throw new Error("401: 1С-ийн нэр/нууц үг буруу"); // дахин оролдох хэрэггүй
      if (!res.ok) throw new Error(`${res.status}: ${text.slice(0, 300)}`);
      const data = JSON.parse(text) as { rows?: T[] };
      if (!Array.isArray(data.rows)) throw new Error(`Хариунд "rows" массив алга: ${text.slice(0, 200)}`);
      return data.rows;
    } catch (err) {
      if (!(err instanceof Error && /^\d{3}:/.test(err.message))) logOnecCall("hub", path, startedAt, "error");
      lastErr = err;
      if (err instanceof Error && err.message.startsWith("401")) break;
      if (attempt < retries) await sleep(5_000 * attempt);
    }
  }
  // Алдааны мессежид URL/нууц үг орохгүй: зөвхөн path
  throw new Error(`1С ${path} алдаа: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

export const fetchStock = (date: string, opts?: FetchOpts) => getRows<StockRow>("/hs/dash/stock", { asof: date }, opts);
export const fetchSales = (from: string, to: string) => getRows<SalesRow>("/hs/dash/sales", { from, to });
export const fetchPl = (from: string, to: string) => getRows<PlRow>("/hs/dash/pl", { from, to });
export const fetchReceivables = (date: string) => getRows<ReceivableRow>("/hs/dash/receivables", { asof: date });
export const fetchCash = (from: string, to: string) => getRows<CashRow>("/hs/dash/cash", { from, to });
