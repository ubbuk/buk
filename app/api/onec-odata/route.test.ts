import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetLimits } from "@/lib/onec-odata/limits";
import { resetMetadataCache } from "@/lib/onec-odata/service";

// The real handlers on the isolated test DB; only the session lookup and the outgoing fetch to 1С are replaced.
const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("next-auth", () => ({ getServerSession: async () => session.current }));

import { GET as DATA } from "./data/route";
import { GET as OBJECTS } from "./objects/route";

const P = "odata-t-";
const XML = `<Schema><EntityType Name="Catalog_Номенклатура"><Property Name="Code" Type="Edm.String"/><Property Name="Description" Type="Edm.String"/></EntityType>
<EntityType Name="Catalog_Сотрудники"><Property Name="Code" Type="Edm.String"/></EntityType>
<EntityType Name="Catalog_Сертификаты"><Property Name="Code" Type="Edm.String"/></EntityType>
<EntityType Name="Document_Продажа"><Property Name="Date" Type="Edm.DateTime"/><Property Name="Number" Type="Edm.String"/></EntityType>
<EntitySet Name="Catalog_Номенклатура" EntityType="S.Catalog_Номенклатура"/><EntitySet Name="Catalog_Сотрудники" EntityType="S.Catalog_Сотрудники"/><EntitySet Name="Catalog_Сертификаты" EntityType="S.Catalog_Сертификаты"/>
<EntitySet Name="Document_Продажа" EntityType="S.Document_Продажа"/></Schema>`;
const ENV = {
  ONEC_ODATA_BASE_URL: "http://1c.test/b/odata/standard.odata",
  ONEC_ODATA_USER: "svc_odata_user",
  ONEC_ODATA_PASSWORD: "s3cret-pass",
  ONEC_ODATA_DENY: "Сертификат",
  ONEC_ODATA_PAYROLL: "Сотрудник",
  ONEC_ODATA_STOREKEEPER_ALLOW: "Номенклатура",
};
const roles = ["ADMIN", "BOSS", "DIRECTOR", "STOREKEEPER", "EMPLOYEE", "MANAGER"] as const;
const as = (r: (typeof roles)[number] | null) => {
  session.current = r ? { user: { id: `${P}${r}`, role: r, name: r, email: `${P}${r}@t.local`, departmentId: null } } : null;
};
const get = (path: string) => new Request(`http://localhost${path}`, { headers: { "x-forwarded-for": "10.1.2.3" } });
const audit = (actor: string, action: "ONEC_ODATA_VIEW" | "ONEC_ODATA_DENIED") =>
  prisma.auditLog.findMany({ where: { actorId: `${P}${actor}`, action }, orderBy: { createdAt: "asc" } });
const dataCalls = vi.fn();

beforeAll(async () => {
  for (const r of roles) {
    await prisma.user.upsert({ where: { id: `${P}${r}` }, update: {}, create: { id: `${P}${r}`, email: `${P}${r}@test.local`, name: r, role: r, passwordHash: "x" } });
  }
});
afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
});
const setPayroll = (r: (typeof roles)[number], v: boolean) => prisma.user.update({ where: { id: `${P}${r}` }, data: { canViewPayroll: v } });

beforeEach(async () => {
  for (const r of roles) await setPayroll(r, false);
  resetLimits();
  resetMetadataCache();
  dataCalls.mockClear();
  Object.assign(process.env, ENV);
  await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: P } } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      expect(init.method).toBe("GET");
      if (url.includes("$metadata")) return new Response(XML, { status: 200 });
      dataCalls(url);
      return new Response(JSON.stringify({ value: [{ Code: "1", Description: "Бараа" }] }), { status: 200 });
    })
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of Object.keys(ENV)) delete process.env[k];
});

const q = (o: string, extra = "") => `/api/onec-odata/data?object=${encodeURIComponent(o)}${extra}`;

describe("/api/onec-odata", () => {
  it("no session -> 401 on both routes; nothing is fetched", async () => {
    as(null);
    expect((await OBJECTS()).status).toBe(401);
    expect((await DATA(get(q("Catalog_Номенклатура")))).status).toBe(401);
    expect(dataCalls).not.toHaveBeenCalled();
  });

  it("a role without access -> 403 and the attempt is audit-logged; nothing is fetched", async () => {
    for (const r of ["EMPLOYEE", "MANAGER"] as const) {
      as(r);
      expect((await OBJECTS()).status).toBe(403);
      expect((await DATA(get(q("Catalog_Номенклатура")))).status).toBe(403);
      expect((await audit(r, "ONEC_ODATA_DENIED")).length).toBe(1);
    }
    expect(dataCalls).not.toHaveBeenCalled();
  });

  it("an ADMIN reads an allowed object; who/when/what is logged, the search text is not", async () => {
    as("ADMIN");
    const res = await DATA(get(q("Catalog_Номенклатура", "&q=Иванов&code=7&page=1")));
    expect(res.status).toBe(200);
    expect((await res.json()).rows).toHaveLength(1);
    const [row] = await audit("ADMIN", "ONEC_ODATA_VIEW");
    expect(row).toMatchObject({ entityType: "OneCObject", entityId: "Catalog_Номенклатура" });
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.afterJson).not.toContain("Иванов");
    expect(JSON.parse(row.afterJson!)).toMatchObject({ code: true, search: true, page: 1 });
  });

  it("the browser is for the ADMIN only: management and the storekeeper (even payroll-flagged) are refused by both routes, and it is logged", async () => {
    for (const r of ["BOSS", "DIRECTOR", "STOREKEEPER"] as const) {
      await setPayroll(r, true);
      as(r);
      expect((await OBJECTS()).status, `${r} list`).toBe(403);
      expect((await DATA(get(q("Catalog_Номенклатура")))).status, `${r} data`).toBe(403);
      expect((await audit(r, "ONEC_ODATA_DENIED")).length, r).toBe(1);
    }
    expect(dataCalls).not.toHaveBeenCalled();
  });

  it("a DENY object is 403 for everyone including a payroll-flagged ADMIN, and is logged as denied", async () => {
    await setPayroll("ADMIN", true);
    as("ADMIN");
    expect((await DATA(get(q("Catalog_Сертификаты")))).status).toBe(403);
    expect((await audit("ADMIN", "ONEC_ODATA_DENIED")).length).toBe(1);
    expect(dataCalls).not.toHaveBeenCalled();
    const list = (await (await OBJECTS()).json()).objects as { name: string }[];
    expect(list.map((o) => o.name)).not.toContain("Catalog_Сертификаты");
  });

  it("a PAYROLL object: refused to an ADMIN without the flag, opened to an ADMIN with it", async () => {
    as("ADMIN");
    expect((await DATA(get(q("Catalog_Сотрудники")))).status).toBe(403);
    expect(((await (await OBJECTS()).json()).objects as { name: string }[]).map((o) => o.name)).not.toContain("Catalog_Сотрудники");
    expect(dataCalls).not.toHaveBeenCalled();
    await setPayroll("ADMIN", true);
    expect((await DATA(get(q("Catalog_Сотрудники")))).status).toBe(200);
    expect(((await (await OBJECTS()).json()).objects as { name: string }[]).map((o) => o.name)).toContain("Catalog_Сотрудники");
  });

  it("the flag is read from the DB on every request: revoking it takes effect on the very next request, same session", async () => {
    await setPayroll("ADMIN", true);
    as("ADMIN"); // one and the same session object for the whole test
    expect((await DATA(get(q("Catalog_Сотрудники", "&q=1")))).status).toBe(200);
    await setPayroll("ADMIN", false);
    expect((await DATA(get(q("Catalog_Сотрудники", "&q=1")))).status).toBe(403); // same filter: not served from cache either
    await setPayroll("ADMIN", true);
    expect((await DATA(get(q("Catalog_Сотрудники", "&q=1")))).status).toBe(200);
  });

  it("the role is read from the DB too: an account that lost the ADMIN role, or was deactivated, loses access at once", async () => {
    as("ADMIN");
    expect((await DATA(get(q("Catalog_Номенклатура")))).status).toBe(200);
    await prisma.user.update({ where: { id: `${P}ADMIN` }, data: { role: "EMPLOYEE" } });
    expect((await DATA(get(q("Catalog_Номенклатура")))).status).toBe(403);
    await prisma.user.update({ where: { id: `${P}ADMIN` }, data: { role: "ADMIN", isActive: false } });
    expect((await DATA(get(q("Catalog_Номенклатура")))).status).toBe(401);
    await prisma.user.update({ where: { id: `${P}ADMIN` }, data: { isActive: true } });
  });

  it("an unknown name is 404, never forwarded; raw OData parameters from the caller are ignored", async () => {
    as("ADMIN");
    expect((await DATA(get(q("Catalog_Нет")))).status).toBe(404);
    expect((await DATA(get(q("Catalog_Номенклатура?$filter=1 eq 1")))).status).toBe(404);
    expect((await DATA(get("/api/onec-odata/data"))).status).toBe(400);
    const ok = await DATA(get(q("Catalog_Номенклатура", "&$filter=Code%20ne%20null&$top=5000&$select=Password&$expand=Сотрудник")));
    expect(ok.status).toBe(200);
    const url = decodeURIComponent(dataCalls.mock.calls[0][0] as string);
    expect(url).not.toMatch(/Password|Code ne null|\$top=5000|Сотрудник/);
    expect(url).toContain("$top=51");
  });

  it("bad filter values are 400, not an error page", async () => {
    as("ADMIN");
    expect((await DATA(get(q("Document_Продажа", "&dateFrom=not-a-date")))).status).toBe(400);
  });

  it("the 31st request within a minute is 429 with Retry-After", async () => {
    as("ADMIN");
    let last: Response | null = null;
    for (let i = 0; i < 31; i++) last = await DATA(get(q("Catalog_Номенклатура", `&q=${i}`)));
    expect(last!.status).toBe(429);
    expect(Number(last!.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("if the access cannot be logged, no data is returned (fail closed)", async () => {
    as("ADMIN");
    // (vi.spyOn + mockRestore would leave the Prisma delegate without a `create`: swap it by hand and put it back)
    const delegate = prisma.auditLog as unknown as { create: unknown };
    const original = delegate.create;
    delegate.create = async () => {
      throw new Error("db down");
    };
    let res: Response;
    try {
      res = await DATA(get(q("Catalog_Номенклатура")));
    } finally {
      delegate.create = original;
    }
    expect(res.status).toBe(503);
    expect(dataCalls).not.toHaveBeenCalled();
  });

  it("a missing deny list -> 503 with a clear message and no request to 1С", async () => {
    as("ADMIN");
    delete process.env.ONEC_ODATA_DENY;
    const res = await DATA(get(q("Catalog_Номенклатура")));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("ONEC_ODATA_DENY");
    expect(dataCalls).not.toHaveBeenCalled();
  });
});

describe("/api/onec-odata: labels are a display matter only", () => {
  it("answers with the real 1С names, never with a Mongolian label, and an object cannot be requested by its label", async () => {
    as("ADMIN");
    const list = await (await OBJECTS()).json();
    expect(list.objects.map((o: { name: string }) => o.name)).toContain("Catalog_Номенклатура");
    expect(JSON.stringify(list)).not.toContain("Бараа материал");
    const data = await DATA(get(q("Catalog_Номенклатура")));
    const body = await data.json();
    expect(body.object).toBe("Catalog_Номенклатура");
    expect(body.columns.map((c: { key: string }) => c.key)).toEqual(["Code", "Description"]); // not «Код», «Нэр»
    expect(JSON.stringify(body)).not.toContain("Бараа материал");
    // the label is not a name: 404, nothing reaches 1С
    expect((await DATA(get(q("Бараа материал")))).status).toBe(404);
    expect((await DATA(get(q("Харилцагч")))).status).toBe(404);
  });

  it("a translated object stays closed to an unflagged viewer: the label gives no way in", async () => {
    as("ADMIN");
    expect((await DATA(get(q("Catalog_Сотрудники")))).status).toBe(403); // «Ажилтан» in Mongolian, still PAYROLL by its real name
    expect((await DATA(get(q("Ажилтан")))).status).toBe(404);
    expect((await DATA(get(q("Catalog_Сертификаты")))).status).toBe(403);
  });
});
