import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canUseOdata, loadPolicy, objectAllowed, type Viewer } from "./access";
import { OdataConfigError, denyPatterns, payrollPatterns } from "./config";
import { consumeRate, resetLimits } from "./limits";
import { parseMetadata, type EntityInfo } from "./metadata";
import { buildFilter, buildPath, defaultRange, normalizeQuery, QueryError } from "./query";
import { listObjects, queryObject, resetMetadataCache, resolveObject } from "./service";
import { OdataError } from "./client";

// Cyrillic names, an association-based navigation property, a tabular part and a register: the shape of a real 1С $metadata.
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx Version="1.0"><edmx:DataServices><Schema Namespace="StandardODATA">
<EntityType Name="Catalog_Номенклатура"><Key><PropertyRef Name="Ref_Key"/></Key>
  <Property Name="Ref_Key" Type="Edm.Guid" Nullable="false"/><Property Name="Code" Type="Edm.String"/>
  <Property Name="Description" Type="Edm.String"/><Property Name="Цена" Type="Edm.Double"/>
  <Property Name="Склад_Key" Type="Edm.Guid"/>
  <NavigationProperty Name="Склад" Relationship="StandardODATA.Catalog_Номенклатура_Склад" FromRole="Catalog_Номенклатура" ToRole="Catalog_Склады"/>
  <NavigationProperty Name="Сотрудник" Relationship="StandardODATA.Catalog_Номенклатура_Сотрудник" FromRole="Catalog_Номенклатура" ToRole="Catalog_Сотрудники"/>
  <Property Name="Сотрудник_Key" Type="Edm.Guid"/></EntityType>
<EntityType Name="Catalog_Склады"><Property Name="Code" Type="Edm.String"/><Property Name="Description" Type="Edm.String"/></EntityType>
<EntityType Name="Catalog_Сотрудники"><Property Name="Code" Type="Edm.String"/><Property Name="Description" Type="Edm.String"/></EntityType>
<EntityType Name="Document_Реализация"><Property Name="Number" Type="Edm.String"/><Property Name="Date" Type="Edm.DateTime"/>
  <Property Name="Posted" Type="Edm.Boolean"/><Property Name="СуммаДокумента" Type="Edm.Double"/><Property Name="DataVersion" Type="Edm.String"/></EntityType>
<EntityType Name="AccumulationRegister_ТоварыНаСкладах"><Property Name="Period" Type="Edm.DateTime"/><Property Name="Количество" Type="Edm.Double"/></EntityType>
<EntityType Name="Catalog_Зарплата"><Property Name="Code" Type="Edm.String"/></EntityType>
<EntityType Name="Catalog_Сертификаты"><Property Name="Code" Type="Edm.String"/></EntityType>
<Association Name="Catalog_Номенклатура_Склад"><End Type="StandardODATA.Catalog_Номенклатура" Role="Catalog_Номенклатура" Multiplicity="*"/><End Type="StandardODATA.Catalog_Склады" Role="Catalog_Склады" Multiplicity="0..1"/></Association>
<Association Name="Catalog_Номенклатура_Сотрудник"><End Type="StandardODATA.Catalog_Номенклатура" Role="Catalog_Номенклатура" Multiplicity="*"/><End Type="StandardODATA.Catalog_Сотрудники" Role="Catalog_Сотрудники" Multiplicity="0..1"/></Association>
<EntityContainer Name="E">
<EntitySet Name="Catalog_Номенклатура" EntityType="StandardODATA.Catalog_Номенклатура"/>
<EntitySet Name="Catalog_Склады" EntityType="StandardODATA.Catalog_Склады"/>
<EntitySet Name="Catalog_Сотрудники" EntityType="StandardODATA.Catalog_Сотрудники"/>
<EntitySet Name="Catalog_Зарплата" EntityType="StandardODATA.Catalog_Зарплата"/>
<EntitySet Name="Catalog_Сертификаты" EntityType="StandardODATA.Catalog_Сертификаты"/>
<EntitySet Name="Document_Реализация" EntityType="StandardODATA.Document_Реализация"/>
<EntitySet Name="AccumulationRegister_ТоварыНаСкладах" EntityType="StandardODATA.AccumulationRegister_ТоварыНаСкладах"/>
</EntityContainer></Schema></edmx:DataServices></edmx:Edmx>`;

const meta = parseMetadata(XML);
const nomen = meta.get("Catalog_Номенклатура") as EntityInfo;
const doc = meta.get("Document_Реализация") as EntityInfo;
const reg = meta.get("AccumulationRegister_ТоварыНаСкладах") as EntityInfo;

const ENV = {
  ONEC_ODATA_BASE_URL: "http://1c.test/base/odata/standard.odata",
  ONEC_ODATA_USER: "svc_odata_user",
  ONEC_ODATA_PASSWORD: "s3cret-pass",
  ONEC_ODATA_DENY: "Сертификат, ЭлектроннаяПодпись",
  ONEC_ODATA_PAYROLL: "Сотрудник, Зарплат",
  ONEC_ODATA_STOREKEEPER_ALLOW: "Номенклатура, Склад, ТоварыНаСкладах",
};
const policy = loadPolicy(ENV);
const V = (role: string, canViewPayroll = false): Viewer => ({ role, canViewPayroll });

describe("metadata", () => {
  it("parses object names, kinds, properties and association targets", () => {
    expect([...meta.keys()]).toHaveLength(7);
    expect(nomen.kind).toBe("catalog");
    expect(doc.kind).toBe("document");
    expect(reg.kind).toBe("register");
    expect(nomen.properties.find((p) => p.name === "Цена")?.type).toBe("Edm.Double");
    expect(nomen.navs.find((n) => n.name === "Склад")).toMatchObject({ target: "Catalog_Склады", collection: false });
  });
});

describe("access", () => {
  it("management sees everything except DENY and PAYROLL objects (without the payroll flag)", () => {
    for (const role of ["ADMIN", "DIRECTOR", "CHIEF_ACCOUNTANT", "BOSS"]) {
      expect(objectAllowed(V(role), "Catalog_Номенклатура", policy), role).toBe(true);
      expect(objectAllowed(V(role), "Catalog_Сотрудники", policy), role).toBe(false); // PAYROLL, no flag
      expect(objectAllowed(V(role), "Catalog_ЗАРПЛАТА", policy), role).toBe(false); // case-insensitive substring
      expect(objectAllowed(V(role), "Catalog_Сертификаты", policy), role).toBe(false); // DENY
    }
  });

  it("DENY beats everything: no role and no payroll flag opens it", () => {
    for (const role of ["ADMIN", "DIRECTOR", "CHIEF_ACCOUNTANT", "BOSS", "STOREKEEPER"]) {
      expect(objectAllowed(V(role, true), "Catalog_Сертификаты", policy), role).toBe(false);
      expect(objectAllowed(V(role, false), "Catalog_Сертификаты", policy), role).toBe(false);
    }
    // an object matching both lists is closed (DENY first)
    const both = { deny: ["Сотрудник"], payroll: ["Сотрудник"], storekeeperAllow: [] };
    expect(objectAllowed(V("ADMIN", true), "Catalog_Сотрудники", both)).toBe(false);
  });

  it("PAYROLL: only the flag opens it, whatever the role (an ADMIN without the flag is refused, a flagged storekeeper is not)", () => {
    expect(objectAllowed(V("ADMIN", false), "Catalog_Сотрудники", policy)).toBe(false);
    expect(objectAllowed(V("ADMIN", true), "Catalog_Сотрудники", policy)).toBe(true);
    expect(objectAllowed(V("DIRECTOR", true), "Catalog_Зарплата", policy)).toBe(true);
    expect(objectAllowed(V("DIRECTOR", false), "Catalog_Зарплата", policy)).toBe(false);
    // role-independent: the storekeeper's allow list does not list payroll, yet the flag opens it
    expect(objectAllowed(V("STOREKEEPER", false), "Catalog_Сотрудники", policy)).toBe(false);
    expect(objectAllowed(V("STOREKEEPER", true), "Catalog_Сотрудники", policy)).toBe(true);
    // the flag does not widen anything else: a flagged storekeeper still only sees the warehouse objects
    expect(objectAllowed(V("STOREKEEPER", true), "Document_Реализация", policy)).toBe(false);
  });

  it("the storekeeper sees only the warehouse objects, never a denied one", () => {
    expect(objectAllowed(V("STOREKEEPER"), "Catalog_Номенклатура", policy)).toBe(true);
    expect(objectAllowed(V("STOREKEEPER"), "AccumulationRegister_ТоварыНаСкладах", policy)).toBe(true);
    expect(objectAllowed(V("STOREKEEPER"), "Document_Реализация", policy)).toBe(false);
    expect(objectAllowed(V("STOREKEEPER"), "Catalog_Сертификаты", policy)).toBe(false);
    const open = { deny: ["Сертификат"], payroll: [], storekeeperAllow: ["Сертификат", "Склад"] };
    expect(objectAllowed(V("STOREKEEPER"), "Catalog_Сертификаты", open)).toBe(false); // deny wins over allow
  });

  it("every other role sees nothing, even with the payroll flag set; an unset allow list means the storekeeper sees nothing", () => {
    for (const role of ["EMPLOYEE", "MANAGER", "ENGINEERING", "", "NOPE"]) {
      expect(canUseOdata(role)).toBe(false);
      expect(objectAllowed(V(role), "Catalog_Номенклатура", policy)).toBe(false);
      expect(objectAllowed(V(role, true), "Catalog_Сотрудники", policy)).toBe(false);
    }
    expect(canUseOdata(undefined)).toBe(false);
    expect(canUseOdata(null)).toBe(false);
    expect(objectAllowed(V("STOREKEEPER"), "Catalog_Номенклатура", { deny: ["x"], payroll: [], storekeeperAllow: [] })).toBe(false);
  });

  it("fails closed when the deny or payroll list is not configured", () => {
    expect(() => denyPatterns({})).toThrow(OdataConfigError);
    expect(() => denyPatterns({ ONEC_ODATA_DENY: "  ,; " })).toThrow(OdataConfigError);
    expect(() => payrollPatterns({})).toThrow(OdataConfigError);
    expect(() => payrollPatterns({ ONEC_ODATA_PAYROLL: " , " })).toThrow(OdataConfigError);
    expect(() => loadPolicy({})).toThrow(OdataConfigError);
    expect(() => loadPolicy({ ONEC_ODATA_DENY: "x" })).toThrow(OdataConfigError); // payroll missing: payroll objects would be open
  });
});

describe("query builder: the server builds the URL, user text is only ever a quoted literal", () => {
  const today = new Date("2026-11-13T10:00:00Z");

  it("caps $top at 100 (+1 to detect a next page), clamps the page and ignores junk", () => {
    expect(normalizeQuery(nomen, { pageSize: 5000 }, today).pageSize).toBe(100);
    expect(normalizeQuery(nomen, { pageSize: 0 }, today).pageSize).toBe(1);
    expect(normalizeQuery(nomen, { page: -3 }, today).page).toBe(1);
    expect(normalizeQuery(nomen, { page: 99999 }, today).page).toBe(1000);
    const path = buildPath(nomen, normalizeQuery(nomen, { page: 3, pageSize: 100 }, today), []);
    expect(path).toContain("$top=101");
    expect(path).toContain("$skip=200");
  });

  it("documents and registers default to the last month; catalogs do not", () => {
    expect(defaultRange(today)).toEqual({ from: "2026-10-14", to: "2026-11-13" });
    expect(normalizeQuery(doc, {}, today)).toMatchObject({ dateFrom: "2026-10-14", dateTo: "2026-11-13" });
    expect(normalizeQuery(reg, {}, today)).toMatchObject({ dateFrom: "2026-10-14", dateTo: "2026-11-13" });
    expect(normalizeQuery(nomen, {}, today)).toMatchObject({ dateFrom: null, dateTo: null });
    expect(buildFilter(doc, normalizeQuery(doc, {}, today))).toBe("Date ge datetime'2026-10-14T00:00:00' and Date le datetime'2026-11-13T23:59:59'");
    expect(buildFilter(reg, normalizeQuery(reg, { dateFrom: "2026-01-01" }, today))).toBe("Period ge datetime'2026-01-01T00:00:00'");
  });

  it("rejects malformed dates and over-long or control-character text", () => {
    for (const bad of ["2026-13-01", "2026-02-30", "yesterday", "2026-1-1", "2026-01-01' or 1 eq 1"]) {
      expect(() => normalizeQuery(doc, { dateFrom: bad }, today), bad).toThrow(QueryError);
    }
    expect(() => normalizeQuery(doc, { dateFrom: "2026-02-01", dateTo: "2026-01-01" }, today)).toThrow(QueryError);
    expect(() => normalizeQuery(nomen, { q: "x".repeat(101) }, today)).toThrow(QueryError);
    expect(() => normalizeQuery(nomen, { code: "a\u0000b" }, today)).toThrow(QueryError);
  });

  it("turns an injection attempt into an escaped literal; there is no way to send a raw $filter", () => {
    const f = buildFilter(nomen, normalizeQuery(nomen, { q: "x') or true eq true or substringof('y", code: "1' or Code ne '" }, today));
    expect(f).toBe("Code eq '1'' or Code ne ''' and substringof('x'') or true eq true or substringof(''y',Description) eq true");
    // the QueryInput type has no filter/select/expand/orderby field; extra keys are never read
    const path = buildPath(nomen, normalizeQuery(nomen, { $filter: "Code ne null", $expand: "Сотрудник", $top: 5000 } as never, today), []);
    expect(path).not.toContain("Сотрудник");
    expect(path).not.toContain("ne%20null");
    expect(path).toContain("$top=51");
  });

  it("only filters on fields the entity really has", () => {
    expect(buildFilter(reg, normalizeQuery(reg, { code: "1", q: "x" }, today))).toBe("Period ge datetime'2026-10-14T00:00:00' and Period le datetime'2026-11-13T23:59:59'");
  });

  it("percent-encodes the Cyrillic object name; the name never carries user text", () => {
    expect(buildPath(nomen, normalizeQuery(nomen, {}, today), [])).toMatch(/^Catalog_%D0%9D%D0%BE%D0%BC/);
  });
});

describe("rate limit", () => {
  beforeEach(resetLimits);
  it("allows 30 requests a minute per user, then 429-style refusal; a new window resets; users are independent", () => {
    const t = 1_000_000;
    for (let i = 0; i < 30; i++) expect(consumeRate("u1", t + i).ok).toBe(true);
    const refused = consumeRate("u1", t + 31);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.retryAfterSeconds).toBeGreaterThan(0);
    expect(consumeRate("u2", t + 32).ok).toBe(true);
    expect(consumeRate("u1", t + 61_000).ok).toBe(true);
  });
});

describe("service (fetch is mocked; nothing leaves the machine)", () => {
  const calls: { url: string; init: RequestInit }[] = [];
  let respond: (url: string) => Response;

  beforeEach(() => {
    resetLimits();
    resetMetadataCache();
    calls.length = 0;
    Object.assign(process.env, ENV);
    respond = (url) =>
      url.includes("$metadata")
        ? new Response(XML, { status: 200 })
        : new Response(JSON.stringify({ "odata.metadata": "x", value: Array.from({ length: 3 }, (_, i) => ({ Code: String(i), Description: `Бараа ${i}`, Склад: { Description: "Төв агуулах", Code: "01", Extra: "x" }, Склад_Key: "guid", Items: [{ a: 1 }] })) }), { status: 200 });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return respond(url);
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of Object.keys(ENV)) delete process.env[k];
  });

  it("every call is a GET to the configured base only, with the credentials in the Authorization header only", async () => {
    const entity = await resolveObject(V("ADMIN"), policy, "Catalog_Номенклатура");
    await queryObject(V("ADMIN"), policy, entity, { q: "тест", pageSize: 2 });
    expect(calls.length).toBe(2); // $metadata + data
    for (const c of calls) {
      expect(c.init.method).toBe("GET");
      expect(c.url.startsWith("http://1c.test/base/odata/standard.odata/")).toBe(true);
      expect(c.url).not.toContain("s3cret-pass");
      expect(c.url).not.toContain("svc_odata_user");
      expect(c.init.body).toBeUndefined();
      const auth = (c.init.headers as Record<string, string>).Authorization;
      expect(Buffer.from(auth.replace("Basic ", ""), "base64").toString("utf8")).toBe("svc_odata_user:s3cret-pass");
    }
  });

  it("an unknown or denied object never reaches 1С; a denied one is a 403, an unknown one a 404", async () => {
    await expect(resolveObject(V("ADMIN"), policy, "Catalog_Несуществует")).rejects.toMatchObject({ status: 404 });
    await expect(resolveObject(V("ADMIN"), policy, "Catalog_Сотрудники")).rejects.toMatchObject({ status: 403 });
    await expect(resolveObject(V("ADMIN"), policy, "Catalog_Номенклатура?$filter=x")).rejects.toMatchObject({ status: 404 });
    await expect(resolveObject(V("ADMIN"), policy, "../Catalog_Номенклатура")).rejects.toBeInstanceOf(OdataError);
    expect(calls.filter((c) => !c.url.includes("$metadata"))).toHaveLength(0);
  });

  it("the list shows each role only what it may open", async () => {
    expect((await listObjects(V("ADMIN"), policy)).map((o) => o.name)).toEqual(
      ["AccumulationRegister_ТоварыНаСкладах", "Catalog_Номенклатура", "Catalog_Склады", "Document_Реализация"].sort((a, b) => a.localeCompare(b))
    );
    expect((await listObjects(V("STOREKEEPER"), policy)).map((o) => o.name)).not.toContain("Document_Реализация");
    expect((await listObjects(V("EMPLOYEE"), policy))).toEqual([]);
  });

  it("expands only references the role may see; a denied target is never expanded", async () => {
    const entity = await resolveObject(V("ADMIN"), policy, "Catalog_Номенклатура");
    await queryObject(V("ADMIN"), policy, entity, {});
    const url = decodeURIComponent(calls[calls.length - 1].url);
    expect(url).toContain("$expand=Склад");
    expect(url).not.toContain("Сотрудник"); // Catalog_Сотрудники is on the deny list
  });

  it("the storekeeper's cache entry is separate: a reference only management may see is not expanded for them", async () => {
    const narrow = { deny: ["Сотрудник"], payroll: [], storekeeperAllow: ["Номенклатура"] }; // no Склад for the storekeeper
    const entity = await resolveObject(V("ADMIN"), narrow, "Catalog_Номенклатура");
    const admin = await queryObject(V("ADMIN"), narrow, entity, {});
    const keeper = await queryObject(V("STOREKEEPER"), narrow, entity, {});
    expect(admin.cached).toBe(false);
    expect(keeper.cached).toBe(false); // not served from the admin's entry
    expect(admin.columns.some((c) => c.key === "Склад")).toBe(true);
    expect(keeper.columns.some((c) => c.key === "Склад")).toBe(false);
  });

  it("returns a slim row (reference -> Description/Code only, no nested collections, _Key kept out of the columns) and detects the next page", async () => {
    const entity = await resolveObject(V("ADMIN"), policy, "Catalog_Номенклатура");
    const page = await queryObject(V("ADMIN"), policy, entity, { pageSize: 2 });
    expect(page.rows).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    expect(page.rows[0].Склад).toEqual({ Description: "Төв агуулах", Code: "01" });
    expect(page.rows[0]).not.toHaveProperty("Items");
    expect(page.columns.map((c) => c.key)).toEqual(["Code", "Description", "Склад", "Цена"]);
    expect(page.columns.some((c) => c.key.endsWith("_Key"))).toBe(false);
  });

  it("serves an identical request from the 5-minute cache and refetches after it expires", async () => {
    const entity = await resolveObject(V("ADMIN"), policy, "Catalog_Номенклатура");
    const t0 = new Date("2026-11-13T10:00:00Z");
    const a = await queryObject(V("ADMIN"), policy, entity, { q: "а" }, t0);
    const dataCalls = () => calls.filter((c) => !c.url.includes("$metadata")).length;
    expect(dataCalls()).toBe(1);
    expect((await queryObject(V("ADMIN"), policy, entity, { q: "а" }, new Date(t0.getTime() + 4 * 60_000))).cached).toBe(true);
    expect(dataCalls()).toBe(1);
    expect(a.cached).toBe(false);
    await queryObject(V("ADMIN"), policy, entity, { q: "б" }, new Date(t0.getTime() + 4 * 60_000)); // other filter: not the same entry
    expect(dataCalls()).toBe(2);
    expect((await queryObject(V("ADMIN"), policy, entity, { q: "а" }, new Date(t0.getTime() + 6 * 60_000))).cached).toBe(false);
    expect(dataCalls()).toBe(3);
  });

  it("retries once without $expand when 1С rejects it, and says so", async () => {
    respond = (url) => {
      if (url.includes("$metadata")) return new Response(XML, { status: 200 });
      if (url.includes("$expand")) return new Response("boom", { status: 500 });
      return new Response(JSON.stringify({ value: [{ Code: "1" }] }), { status: 200 });
    };
    const entity = await resolveObject(V("ADMIN"), policy, "Catalog_Номенклатура");
    const page = await queryObject(V("ADMIN"), policy, entity, {});
    expect(page.expandSkipped).toBe(true);
    expect(page.columns.some((c) => c.key === "Склад")).toBe(false);
  });

  it("never puts the URL, the user name or the password into an error", async () => {
    respond = (url) => (url.includes("$metadata") ? new Response(XML, { status: 200 }) : new Response("secret internals http://1c.test", { status: 500 }));
    const entity = await resolveObject(V("ADMIN"), policy, "Catalog_Склады");
    const err = await queryObject(V("ADMIN"), policy, entity, {}).catch((e) => e);
    expect(err).toBeInstanceOf(OdataError);
    expect(err.message).not.toMatch(/1c\.test|s3cret|svc_odata_user|internals/);
    respond = () => new Response("no", { status: 401 });
    resetMetadataCache();
    const auth = await listObjects(V("ADMIN"), policy).catch((e) => e);
    expect(auth).toMatchObject({ status: 502 }); // our user is not logged out because 1С refused the technical user
    expect(auth.message).not.toMatch(/s3cret|svc_odata_user/);
  });

  it("payroll objects: an unflagged ADMIN and an unflagged DIRECTOR get 403, a flagged DIRECTOR and flagged ADMIN pass, DENY is closed to everyone", async () => {
    for (const v of [V("ADMIN"), V("DIRECTOR"), V("STOREKEEPER")]) {
      await expect(resolveObject(v, policy, "Catalog_Сотрудники"), `${v.role} unflagged`).rejects.toMatchObject({ status: 403 });
    }
    await expect(resolveObject(V("DIRECTOR", true), policy, "Catalog_Сотрудники")).resolves.toMatchObject({ name: "Catalog_Сотрудники" });
    await expect(resolveObject(V("ADMIN", true), policy, "Catalog_Зарплата")).resolves.toMatchObject({ name: "Catalog_Зарплата" });
    await expect(resolveObject(V("STOREKEEPER", true), policy, "Catalog_Сотрудники")).resolves.toBeTruthy(); // role-independent
    for (const v of [V("ADMIN", true), V("DIRECTOR", true), V("STOREKEEPER", true)]) {
      await expect(resolveObject(v, policy, "Catalog_Сертификаты"), `${v.role} DENY`).rejects.toMatchObject({ status: 403 });
    }
  });

  it("the object list shows payroll objects only to a flagged viewer; DENY objects to nobody", async () => {
    const names = async (v: Viewer) => (await listObjects(v, policy)).map((o) => o.name);
    expect(await names(V("DIRECTOR"))).not.toContain("Catalog_Сотрудники");
    expect(await names(V("ADMIN"))).not.toContain("Catalog_Зарплата");
    expect(await names(V("DIRECTOR", true))).toEqual(expect.arrayContaining(["Catalog_Сотрудники", "Catalog_Зарплата"]));
    for (const v of [V("ADMIN", true), V("DIRECTOR", true), V("STOREKEEPER", true)]) expect(await names(v)).not.toContain("Catalog_Сертификаты");
    // a flagged storekeeper gets the payroll objects plus his warehouse objects, nothing else
    expect(await names(V("STOREKEEPER", true))).toEqual(["AccumulationRegister_ТоварыНаСкладах", "Catalog_Зарплата", "Catalog_Номенклатура", "Catalog_Склады", "Catalog_Сотрудники"].sort((a, b) => a.localeCompare(b)));
  });

  it("$expand never reveals a payroll object to an unflagged viewer, and does for a flagged one", async () => {
    const entity = await resolveObject(V("ADMIN"), policy, "Catalog_Номенклатура");
    const plain = await queryObject(V("ADMIN"), policy, entity, {});
    const plainUrl = decodeURIComponent(calls[calls.length - 1].url);
    expect(plainUrl).toContain("$expand=Склад");
    expect(plainUrl).not.toContain("Сотрудник");
    expect(plain.columns.some((c) => c.key === "Сотрудник")).toBe(false);
    expect(JSON.stringify(plain)).not.toContain("Сотрудник");

    await queryObject(V("DIRECTOR", true), policy, entity, {});
    expect(decodeURIComponent(calls[calls.length - 1].url)).toContain("$expand=Склад,Сотрудник");
  });

  it("the cache never hands a payroll-enabled result to an unflagged viewer, in either order", async () => {
    const entity = await resolveObject(V("DIRECTOR"), policy, "Catalog_Номенклатура");
    const withFlag = await queryObject(V("DIRECTOR", true), policy, entity, { q: "а" });
    expect(withFlag.cached).toBe(false);
    expect(withFlag.columns.some((c) => c.key === "Сотрудник")).toBe(true);
    const without = await queryObject(V("DIRECTOR", false), policy, entity, { q: "а" });
    expect(without.cached).toBe(false); // not served from the flagged entry
    expect(without.columns.some((c) => c.key === "Сотрудник")).toBe(false);
    expect((await queryObject(V("DIRECTOR", true), policy, entity, { q: "а" })).cached).toBe(true); // same flag: shared
    expect((await queryObject(V("ADMIN", false), policy, entity, { q: "а" })).cached).toBe(true); // same role class, same flag
    // the reverse order: a fresh cache filled by the unflagged viewer is not served to the flagged one
    resetLimits();
    const fresh = await queryObject(V("DIRECTOR", false), policy, entity, { q: "б" });
    expect(fresh.columns.some((c) => c.key === "Сотрудник")).toBe(false);
    const flagged = await queryObject(V("DIRECTOR", true), policy, entity, { q: "б" });
    expect(flagged.cached).toBe(false);
    expect(flagged.columns.some((c) => c.key === "Сотрудник")).toBe(true);
  });

  it("refuses to run without credentials or base URL (config error, no request sent)", async () => {
    delete process.env.ONEC_ODATA_PASSWORD;
    await expect(listObjects(V("ADMIN"), policy)).rejects.toMatchObject({ status: 503 });
    expect(calls).toHaveLength(0);
  });
});
