// 1С OData хөтчийн үйлчилгээ: $metadata-ийн жагсаалт, эрхийн шалгалт, хуудаслалттай унших. Зөвхөн унших.
import { objectAllowed, roleClass, type ObjectPolicy, type Viewer } from "./access";
import { odataGet, OdataError } from "./client";
import { METADATA_TTL_MS } from "./config";
import { cacheGet, cacheSet } from "./limits";
import { parseMetadata, type EntityInfo, type Metadata, type ObjectKind } from "./metadata";
import { buildPath, dateFieldOf, expandable, normalizeQuery, QueryError, type NormalizedQuery, type QueryInput } from "./query";

let metadataCache: { value: Metadata; expiresAt: number } | null = null;

export async function getMetadata(now = Date.now()): Promise<Metadata> {
  if (metadataCache && metadataCache.expiresAt > now) return metadataCache.value;
  const xml = await odataGet("$metadata", "xml");
  const value = parseMetadata(xml);
  if (value.size === 0) throw new OdataError(502, "1С-ийн $metadata-аас объект олдсонгүй");
  metadataCache = { value, expiresAt: now + METADATA_TTL_MS };
  return value;
}

/** Зөвхөн тестэд */
export function resetMetadataCache() {
  metadataCache = null;
}

export interface ObjectListItem {
  name: string;
  kind: ObjectKind;
}

/** Энэ дүрт харагдах объектууд (хориотой/нярав хаалттай нь жагсаалтад ч байхгүй) */
export async function listObjects(viewer: Viewer, policy: ObjectPolicy): Promise<ObjectListItem[]> {
  const metadata = await getMetadata();
  const out: ObjectListItem[] = [];
  for (const e of metadata.values()) if (objectAllowed(viewer, e.name, policy)) out.push({ name: e.name, kind: e.kind });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Хэрэглэгчийн өгсөн нэрийг $metadata-ийн жагсаалтаар баталгаажуулж, дүрийн эрхийг шалгана.
 * 404: жагсаалтад байхгүй нэр (1С руу хандахгүй). 403: байгаа боловч энэ дүрт хориотой.
 */
export async function resolveObject(viewer: Viewer, policy: ObjectPolicy, name: string): Promise<EntityInfo> {
  const metadata = await getMetadata();
  const entity = metadata.get(name);
  if (!entity) throw new OdataError(404, "Ийм объект олдсонгүй");
  if (!objectAllowed(viewer, name, policy)) throw new OdataError(403, "Энэ объектыг үзэх эрхгүй байна");
  return entity;
}

export interface ColumnInfo {
  key: string;
  type: string;
  /** холбоос: утга нь { Description, Code } объект (expand хийсэн) */
  ref?: boolean;
}

export interface ObjectPage {
  object: string;
  kind: ObjectKind;
  columns: ColumnInfo[];
  rows: Record<string, unknown>[];
  page: number;
  pageSize: number;
  hasMore: boolean;
  dateField: string | null;
  filters: Pick<NormalizedQuery, "dateFrom" | "dateTo" | "code" | "q">;
  /** $expand амжилтгүй болж, холбоосын нэргүйгээр харуулсан */
  expandSkipped: boolean;
}

const FIRST = ["Code", "Description", "Date", "Period", "Number", "Posted"];
const AMOUNT = /Сумма|Дүн|Цена|Үнэ|Количество|Тоо|Итого|Sum|Amount|Price|Qty|Quantity|Total/i;
const NUMERIC = new Set(["Edm.Double", "Edm.Decimal", "Edm.Int16", "Edm.Int32", "Edm.Int64", "Edm.Single"]);
const MAX_COLUMNS = 14;

const hiddenColumn = (name: string) => name.endsWith("_Key") || name.endsWith("_Type") || name === "DataVersion" || name === "Ref_Key";

/** Хүснэгтийн баганууд: Code, Description, Date, Number, Posted, холбоосууд, дүнгийн талбарууд, бусад. _Key/GUID-ийг нууна. */
export function pickColumns(entity: EntityInfo, expanded: readonly string[]): ColumnInfo[] {
  const props = entity.properties.filter((p) => !hiddenColumn(p.name));
  const byName = new Map(props.map((p) => [p.name, p]));
  const cols: ColumnInfo[] = [];
  const seen = new Set<string>();
  const add = (c: ColumnInfo) => {
    if (!seen.has(c.key)) {
      seen.add(c.key);
      cols.push(c);
    }
  };
  for (const n of FIRST) if (byName.has(n)) add({ key: n, type: byName.get(n)!.type });
  for (const n of expanded) add({ key: n, type: "ref", ref: true });
  for (const p of props) if (NUMERIC.has(p.type) && AMOUNT.test(p.name)) add({ key: p.name, type: p.type });
  for (const p of props) add({ key: p.name, type: p.type });
  return cols.slice(0, MAX_COLUMNS);
}

type Row = Record<string, unknown>;

function slimRow(raw: Row, expanded: ReadonlySet<string>): Row {
  const row: Row = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith("odata.")) continue;
    if (expanded.has(k)) {
      const o = v && typeof v === "object" ? (v as Row) : null;
      row[k] = o ? { Description: o.Description ?? null, Code: o.Code ?? null } : null;
    } else if (v !== null && typeof v === "object") {
      continue; // хүснэгтэн хэсэг зэрэг: энэ харагдацад оруулахгүй
    } else {
      row[k] = v;
    }
  }
  return row;
}

function parseRows(text: string): Row[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new OdataError(502, "1С-ийн хариуг уншиж чадсангүй");
  }
  const d = data as { value?: unknown; d?: { results?: unknown } };
  const rows = Array.isArray(d.value) ? d.value : Array.isArray(d.d?.results) ? d.d.results : null;
  if (!rows) throw new OdataError(502, "1С-ийн хариу хүлээсэн хэлбэртэй биш байна");
  return rows as Row[];
}

/**
 * Эрх (resolveObject) аль хэдийн шалгагдсан объектыг унших. Cache нь (дүрийн ангилал, цалингийн эрх, объект, нормчилсон
 * шүүлтүүр)-ээр: няравт эсвэл цалингийн эрхгүй хүнд зөвшөөрөгдөөгүй холбоосын нэр cache-ээр дамжин алдагдахгүй.
 */
export async function queryObject(viewer: Viewer, policy: ObjectPolicy, entity: EntityInfo, input: QueryInput, now = new Date()): Promise<ObjectPage & { cached: boolean }> {
  let q: NormalizedQuery;
  try {
    q = normalizeQuery(entity, input, now);
  } catch (e) {
    if (e instanceof QueryError) throw new OdataError(400, e.message);
    throw e;
  }

  // Түлхүүрт дүрийн ангилал БА цалингийн эрх орно: цалингийн эрхтэй хүний cache эрхгүй хүнд хэзээ ч очихгүй
  const key = `${roleClass(viewer.role)}|payroll=${viewer.canViewPayroll === true ? 1 : 0}|${entity.name}|${JSON.stringify(q)}`;
  const hit = cacheGet<ObjectPage>(key, now.getTime());
  if (hit) return { ...hit, cached: true };

  const metadata = await getMetadata();
  const expand = expandable(entity, metadata, (target) => objectAllowed(viewer, target, policy));

  let text: string;
  let expandSkipped = false;
  let used = expand;
  try {
    text = await odataGet(buildPath(entity, q, expand), "json");
  } catch (e) {
    // $expand-ийг 1С зарим объектод дэмжихгүй байж болно: холбоосын нэргүйгээр нэг удаа дахин оролдоно
    if (expand.length === 0 || !(e instanceof OdataError) || e.status !== 502 || !/алдаа буцаалаа/.test(e.message)) throw e;
    text = await odataGet(buildPath(entity, q, []), "json");
    expandSkipped = true;
    used = [];
  }

  const all = parseRows(text);
  const hasMore = all.length > q.pageSize;
  const expandedSet = new Set(used);
  const result: ObjectPage = {
    object: entity.name,
    kind: entity.kind,
    columns: pickColumns(entity, used),
    rows: all.slice(0, q.pageSize).map((r) => slimRow(r, expandedSet)),
    page: q.page,
    pageSize: q.pageSize,
    hasMore,
    dateField: dateFieldOf(entity),
    filters: { dateFrom: q.dateFrom, dateTo: q.dateTo, code: q.code, q: q.q },
    expandSkipped,
  };
  cacheSet(key, result, now.getTime());
  return { ...result, cached: false };
}
