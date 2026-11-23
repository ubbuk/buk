import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// «Зардал» табын тайлан (onec_pl-аас) ба админы ангиллын дүрэм: бодит handler, тусгаарласан тест DB.
const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("next-auth", () => ({ getServerSession: async () => session.current }));

import { GET as REPORT } from "./report/route";
import { GET as RULES_GET, POST as RULES_POST } from "@/app/api/admin/expense-rules/route";
import { PATCH as RULE_PATCH, DELETE as RULE_DELETE } from "@/app/api/admin/expense-rules/[id]/route";

const P = "expv-";
const TAG = Date.now().toString(36);
const ids = { director: `${P}${TAG}-director`, admin: `${P}${TAG}-admin`, employee: `${P}${TAG}-employee` };
const as = (who: keyof typeof ids | null) => {
  session.current = who ? { user: { id: ids[who], role: who.toUpperCase(), name: who, email: `${ids[who]}@t.local`, departmentId: null } } : null;
};
const get = (path: string) => new Request(`http://localhost${path}`);
const body = (method: string, data?: unknown) => new Request("http://localhost/x", { method, headers: { "Content-Type": "application/json", "x-forwarded-for": "10.5.4.3" }, body: data === undefined ? undefined : JSON.stringify(data) });
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

// Ирээдүйн биш, бодит өгөгдөлтэй мөргүй жил: тестийн мөрүүд л байна
const M = "2020-11";
const PREV = "2020-10";
const pl = (month: string, item: string, amount: number, account = "7000.00", side = "expense") => ({ month, itemCode: "", item, account, accountGroup: account.startsWith("61") ? "cogs" : "admin", side, amount });

beforeAll(async () => {
  const mk = (id: string, role: "ADMIN" | "DIRECTOR" | "EMPLOYEE") => prisma.user.upsert({ where: { id }, update: { role, isActive: true }, create: { id, email: `${id}@test.local`, name: id, role, passwordHash: "x" } });
  await Promise.all([mk(ids.director, "DIRECTOR"), mk(ids.admin, "ADMIN"), mk(ids.employee, "EMPLOYEE")]);
});
beforeEach(async () => {
  await prisma.onecExpenseCategoryRule.deleteMany();
  await prisma.onecPl.deleteMany({ where: { month: { in: [M, PREV, "2020-09"] } } });
});
afterAll(async () => {
  await prisma.onecExpenseCategoryRule.deleteMany();
  await prisma.onecPl.deleteMany({ where: { month: { in: [M, PREV, "2020-09"] } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: Object.values(ids) } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
  await prisma.$disconnect();
});

describe("GET /api/dashboard/expenses/report", () => {
  it("нэвтрээгүй 401, эрхгүй хэрэглэгч 403, буруу сар 400", async () => {
    as(null);
    expect((await REPORT(get(`/x?month=${M}`))).status).toBe(401);
    as("employee");
    expect((await REPORT(get(`/x?month=${M}`))).status).toBe(403);
    as("director");
    expect((await REPORT(get("/x?month=2020-13"))).status).toBe(400);
  });

  it("ердийн ангилалд хувааж, борлуулсан өртгийг тусад нь, дансны код ангилалын нэрэнд гарахгүй", async () => {
    await prisma.onecPl.createMany({
      data: [
        pl(M, "7002 Цахилгааны зардал", 600),
        pl(M, "7029 Түрээсийн зардал", 300),
        pl(M, "6101 Борлуулсан өртөг", 9000, "6101.00"),
        pl(M, "Борлуулалтын орлого", 99999, "5101.00", "income"),
        pl(PREV, "7002 Цахилгааны зардал", 400),
      ],
    });
    as("director");
    const res = await REPORT(get(`/x?month=${M}`));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.empty).toBe(false);
    expect(j.total).toBe(900); // орлого, өртөг ороогүй
    expect(j.cogs.amount).toBe(9000);
    expect(j.prevLoaded).toBe(true);
    expect(j.categories.map((c: { label: string }) => c.label)).toEqual(["Цахилгаан, дулаан, ус", "Түрээс"]);
    expect(j.months).toHaveLength(12);
    expect(j.months[11]).toMatchObject({ month: M, loaded: true, total: 900 });
    expect(j.months[10]).toMatchObject({ month: PREV, loaded: true, total: 400 });
    expect(j.months[9]).toMatchObject({ month: "2020-09", loaded: false });
    expect(JSON.stringify(j.categories.map((c: { label: string }) => c.label))).not.toMatch(/\d{4}/);
  });

  it("өмнөх сар татагдаагүй бол prevLoaded=false (0 биш), сар огт татагдаагүй бол empty", async () => {
    await prisma.onecPl.createMany({ data: [pl(M, "7029 Түрээсийн зардал", 300)] });
    as("director");
    const j = await (await REPORT(get(`/x?month=${M}`))).json();
    expect(j.prevLoaded).toBe(false);
    expect(j.changePct).toBeNull();
    const none = await (await REPORT(get("/x?month=2020-05"))).json();
    expect(none.empty).toBe(true);
  });

  it("админы дүрэм ангиллыг шууд өөрчилнө", async () => {
    await prisma.onecPl.createMany({ data: [pl(M, "Тодорхойгүй зардал", 500)] });
    as("director");
    expect((await (await REPORT(get(`/x?month=${M}`))).json()).categories[0].label).toBe("Бусад");
    await prisma.onecExpenseCategoryRule.create({ data: { field: "ITEM", pattern: "тодорхойгүй", category: "insurance" } });
    const j = await (await REPORT(get(`/x?month=${M}`))).json();
    expect(j.categories[0].label).toBe("Даатгал");
    expect(j.otherWarn).toBe(false);
  });
});

describe("админы зардлын ангиллын дүрэм", () => {
  const valid = { field: "ITEM", pattern: "даатгал", category: "insurance", priority: 10 };

  it("зөвхөн ADMIN", async () => {
    for (const who of [null, "director", "employee"] as const) {
      as(who);
      expect((await RULES_GET()).status, String(who)).toBeGreaterThanOrEqual(401);
      expect((await RULES_POST(body("POST", valid))).status, String(who)).toBe(403);
    }
  });

  it("нэмэх, засах, устгах + аудит; анхдагч дүрмүүд харагдана", async () => {
    as("admin");
    const created = await RULES_POST(body("POST", valid));
    expect(created.status).toBe(201);
    const { id } = await created.json();
    const list = await (await RULES_GET()).json();
    expect(list.rules).toHaveLength(1);
    expect(list.defaults.length).toBeGreaterThan(10);
    expect((await RULE_PATCH(body("PATCH", { category: "bank", isActive: false }), idParams(id))).status).toBe(200);
    expect(await prisma.onecExpenseCategoryRule.findUnique({ where: { id } })).toMatchObject({ category: "bank", isActive: false });
    expect((await RULE_DELETE(body("DELETE"), idParams(id))).status).toBe(200);
    const audits = await prisma.auditLog.findMany({ where: { entityType: "ExpenseCategoryRule", entityId: id }, orderBy: { createdAt: "asc" } });
    expect(audits.map((a) => a.action)).toEqual(["CREATE", "UPDATE", "UPDATE"]);
  });

  it("буруу оролтыг юу буруу гэдгийг хэлж 400-аар буцаана; олдохгүй дүрэм 404", async () => {
    as("admin");
    const bad = (over: object) => RULES_POST(body("POST", { ...valid, ...over }));
    for (const over of [{ pattern: "  " }, { pattern: "x".repeat(81) }, { category: "cogs" }, { field: "PARTY" }, { priority: "1" }]) {
      const r = await bad(over);
      expect(r.status, JSON.stringify(over)).toBe(400);
      expect((await r.json()).error).toBeTruthy();
    }
    expect((await RULE_PATCH(body("PATCH", { category: "bank" }), idParams("missing"))).status).toBe(404);
  });
});
