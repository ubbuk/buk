// Хэрэглэгчийн оролтоос 1С руу явах URL-ийг СЕРВЕР өөрөө бүтээнэ. Хэрэглэгчийн query string-ийг дамжуулахгүй,
// түүхий $filter хүлээж авахгүй: зөвхөн доорх бэлэн шүүлтүүрүүд (огноо, код, нэрийн хайлт) ба тоон хуудаслалт.
import { DEFAULT_PAGE_SIZE, DEFAULT_RANGE_DAYS, MAX_EXPAND, MAX_PAGE, MAX_PAGE_SIZE } from "./config";
import type { EntityInfo, Metadata } from "./metadata";

export interface QueryInput {
  page?: number;
  pageSize?: number;
  dateFrom?: string; // yyyy-MM-dd
  dateTo?: string;
  code?: string;
  q?: string;
}

export interface NormalizedQuery {
  page: number;
  pageSize: number;
  dateFrom: string | null;
  dateTo: string | null;
  code: string | null;
  q: string | null;
}

const DATE_FIELDS = ["Date", "Period"];
const MAX_TEXT = 100;

export class QueryError extends Error {}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

function text(raw: string | undefined, label: string): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (v.length > MAX_TEXT) throw new QueryError(`${label} хэт урт байна (дээд тал нь ${MAX_TEXT} тэмдэгт)`);
  if (/[\u0000-\u001f\u007f]/.test(v)) throw new QueryError(`${label} дотор хориотой тэмдэгт байна`);
  return v;
}

export const dateFieldOf = (e: EntityInfo): string | null =>
  DATE_FIELDS.find((f) => e.properties.some((p) => p.name === f && p.type === "Edm.DateTime")) ?? null;

const hasString = (e: EntityInfo, name: string) => e.properties.some((p) => p.name === name && p.type === "Edm.String");

/** today-аас хойш N хоногийн өмнөх огноо (UTC); тестэд today-г өгнө */
export function defaultRange(today: Date = new Date()): { from: string; to: string } {
  const to = today.toISOString().slice(0, 10);
  const from = new Date(today.getTime() - DEFAULT_RANGE_DAYS * 86_400_000).toISOString().slice(0, 10);
  return { from, to };
}

export function normalizeQuery(entity: EntityInfo, input: QueryInput, today: Date = new Date()): NormalizedQuery {
  const page = Number.isInteger(input.page) && (input.page as number) >= 1 ? Math.min(input.page as number, MAX_PAGE) : 1;
  const sizeRaw = Number.isInteger(input.pageSize) ? (input.pageSize as number) : DEFAULT_PAGE_SIZE;
  const pageSize = Math.min(Math.max(sizeRaw, 1), MAX_PAGE_SIZE);

  let dateFrom = text(input.dateFrom, "Эхлэх огноо");
  let dateTo = text(input.dateTo, "Дуусах огноо");
  if ((dateFrom && !isDate(dateFrom)) || (dateTo && !isDate(dateTo))) throw new QueryError("Огноо yyyy-MM-dd хэлбэртэй байх ёстой");
  if (dateFrom && dateTo && dateFrom > dateTo) throw new QueryError("Эхлэх огноо дуусах огнооноос хойш байж болохгүй");
  // Баримт, регистрт огноо өгөөгүй бол сүүлийн сарыг авна: 1С-ийг хязгааргүй хүсэлтээр ачаалахгүй
  if ((entity.kind === "document" || entity.kind === "register") && dateFilterable(entity) && !dateFrom && !dateTo) {
    const r = defaultRange(today);
    dateFrom = r.from;
    dateTo = r.to;
  }
  if (!dateFilterable(entity)) {
    dateFrom = null;
    dateTo = null;
  }

  return { page, pageSize, dateFrom, dateTo, code: text(input.code, "Код"), q: text(input.q, "Хайлт") };
}

const dateFilterable = (e: EntityInfo) => dateFieldOf(e) !== null;

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function buildFilter(entity: EntityInfo, q: NormalizedQuery): string | null {
  const parts: string[] = [];
  const dateField = dateFieldOf(entity);
  if (dateField && q.dateFrom) parts.push(`${dateField} ge datetime'${q.dateFrom}T00:00:00'`);
  if (dateField && q.dateTo) parts.push(`${dateField} le datetime'${q.dateTo}T23:59:59'`);
  if (q.code) {
    // Лавлахад Code, баримтад Number; аль нь байгаагаар нь (тэмдэгт мөр бол)
    const codeField = ["Code", "Number"].find((f) => hasString(entity, f));
    if (codeField) parts.push(`${codeField} eq ${quote(q.code)}`);
  }
  if (q.q && hasString(entity, "Description")) parts.push(`substringof(${quote(q.q)},Description) eq true`);
  return parts.length ? parts.join(" and ") : null;
}

/**
 * Холбоосын нэрийг харуулахын тулд $expand хийх холбоосууд: `<Нэр>_Key` талбартай, ганц объект руу заасан,
 * зорилтот объект нь МЭДЭГДЭЖ БУЙ, энэ дүрт зөвшөөрөгдсөн (хориотой/нярав хаалттай бол expand хийхгүй).
 */
export function expandable(entity: EntityInfo, metadata: Metadata, allowed: (objectName: string) => boolean): string[] {
  const out: string[] = [];
  for (const nav of entity.navs) {
    if (nav.collection || !nav.target) continue;
    if (!entity.properties.some((p) => p.name === `${nav.name}_Key`)) continue;
    if (!metadata.has(nav.target) || !allowed(nav.target)) continue;
    out.push(nav.name);
    if (out.length >= MAX_EXPAND) break;
  }
  return out;
}

/** Объектын нэр аль хэдийн $metadata-аар баталгаажсан байх ёстой (дуудагч шалгана) */
export function buildPath(entity: EntityInfo, q: NormalizedQuery, expand: readonly string[]): string {
  const params: string[] = ["$format=json", `$top=${q.pageSize + 1}`]; // +1: дараагийн хуудас байгаа эсэхийг мэдэх
  if (q.page > 1) params.push(`$skip=${(q.page - 1) * q.pageSize}`);
  const filter = buildFilter(entity, q);
  if (filter) params.push(`$filter=${encodeURIComponent(filter)}`);
  const orderField = dateFieldOf(entity) ?? (entity.properties.some((p) => p.name === "Code") ? "Code" : null);
  if (orderField) params.push(`$orderby=${encodeURIComponent(orderField + (orderField === "Code" ? "" : " desc"))}`);
  if (expand.length) params.push(`$expand=${expand.map(encodeURIComponent).join(",")}`);
  return `${encodeURIComponent(entity.name)}?${params.join("&")}`;
}
