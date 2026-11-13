// $metadata (EDMX) задлан: объектын жагсаалт, талбар, холбоос. Объектын нэрийг ЗӨВХӨН эндээс баталгаажуулна.

export type ObjectKind = "catalog" | "document" | "register" | "other";

export interface PropertyInfo {
  name: string;
  type: string; // Edm.String, Edm.DateTime, Edm.Boolean, Edm.Double, Edm.Decimal, Edm.Guid, ...
}

export interface NavInfo {
  name: string;
  /** холбоосын зорилтот объектын нэр (мэдэгдэхгүй бол null); Collection (хүснэгтэн хэсэг) бол collection=true */
  target: string | null;
  collection: boolean;
}

export interface EntityInfo {
  name: string;
  kind: ObjectKind;
  properties: PropertyInfo[];
  navs: NavInfo[];
}

export type Metadata = Map<string, EntityInfo>;

export function kindOf(name: string): ObjectKind {
  if (name.startsWith("Catalog_")) return "catalog";
  if (name.startsWith("Document_")) return "document";
  if (/^(Information|Accumulation|Accounting|Calculation)Register_/.test(name)) return "register";
  return "other";
}

const decodeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = decodeXml(m[2]);
  return out;
}

const shortName = (qualified: string) => qualified.slice(qualified.lastIndexOf(".") + 1);

export function parseMetadata(xml: string): Metadata {
  // association -> { role -> зорилтот төрөл }
  const assoc = new Map<string, Map<string, string>>();
  for (const m of xml.matchAll(/<Association\b([^>]*)>([\s\S]*?)<\/Association>/g)) {
    const name = attrs(m[1]).Name;
    if (!name) continue;
    const ends = new Map<string, string>();
    for (const e of m[2].matchAll(/<End\b[^>]*>/g)) {
      const a = attrs(e[0]);
      if (a.Role && a.Type) ends.set(a.Role, shortName(a.Type));
    }
    assoc.set(name, ends);
  }

  const types = new Map<string, { properties: PropertyInfo[]; navs: NavInfo[] }>();
  for (const m of xml.matchAll(/<EntityType\b([^>]*)>([\s\S]*?)<\/EntityType>/g)) {
    const name = attrs(m[1]).Name;
    if (!name) continue;
    const properties: PropertyInfo[] = [];
    for (const p of m[2].matchAll(/<Property\b[^>]*>/g)) {
      const a = attrs(p[0]);
      if (a.Name) properties.push({ name: a.Name, type: a.Type ?? "" });
    }
    const navs: NavInfo[] = [];
    for (const n of m[2].matchAll(/<NavigationProperty\b[^>]*>/g)) {
      const a = attrs(n[0]);
      if (!a.Name) continue;
      const relName = a.Relationship ? shortName(a.Relationship) : "";
      const target = (a.ToRole && assoc.get(relName)?.get(a.ToRole)) || null;
      navs.push({ name: a.Name, target, collection: /Collection\(/.test(a.Type ?? "") });
    }
    types.set(name, { properties, navs });
  }

  const result: Metadata = new Map();
  for (const m of xml.matchAll(/<EntitySet\b[^>]*>/g)) {
    const a = attrs(m[0]);
    if (!a.Name || !a.EntityType) continue;
    const info = types.get(shortName(a.EntityType));
    result.set(a.Name, { name: a.Name, kind: kindOf(a.Name), properties: info?.properties ?? [], navs: info?.navs ?? [] });
  }
  return result;
}
