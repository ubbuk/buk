import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { CashEntry, CashResult } from "@/lib/onec/cash";

// «Мөнгөн хөрөнгө» табын шинэ API-ууд (report, entries) ба админы ангиллын дүрэм: бодит handler, тусгаарласан тест DB.
// 1С-ийн татаалтыг (loadCash) бэлэн өгөгдлөөр солино; session л солигдоно.
const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("next-auth", () => ({ getServerSession: async () => session.current }));

const fixture = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/lib/onec/cash", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/onec/cash")>();
  return { ...real, loadCash: async () => ({ value: fixture.current as CashResult, meta: { fetchedAt: Date.now(), cached: true, stale: false } }) };
});
// баримтын дугаарыг 1С-ээс уншдаг хэсэг: тестэд 1С байхгүй
vi.mock("@/lib/onec/odata-read", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/onec/odata-read")>();
  return { ...real, lookupRows: async (_c: string, keys: string[]) => new Map(keys.map((k) => [k, { Number: `УБ00-${k.slice(-4)}` }])) };
});

import { GET as REPORT } from "./report/route";
import { GET as ENTRIES } from "./entries/route";
import { GET as RULES_GET, POST as RULES_POST } from "@/app/api/admin/cash-rules/route";
import { PATCH as RULE_PATCH, DELETE as RULE_DELETE } from "@/app/api/admin/cash-rules/[id]/route";
import { currentMonth } from "@/lib/onec/dates";

const P = "cashv-";
const TAG = Date.now().toString(36);
const ids = { director: `${P}${TAG}-director`, payrollDirector: `${P}${TAG}-pdirector`, admin: `${P}${TAG}-admin`, employee: `${P}${TAG}-employee` };
const as = (who: keyof typeof ids | null) => {
  session.current = who ? { user: { id: ids[who], role: who === "payrollDirector" ? "DIRECTOR" : who.toUpperCase(), name: who, email: `${ids[who]}@t.local`, departmentId: null } } : null;
};
const month = currentMonth();
const get = (path: string) => new Request(`http://localhost${path}`);
const body = (method: string, data?: unknown) => new Request("http://localhost/x", { method, headers: { "Content-Type": "application/json", "x-forwarded-for": "10.5.4.3" }, body: data === undefined ? undefined : JSON.stringify(data) });

let n = 0;
const entry = (over: Partial<CashEntry>): CashEntry => ({
  id: `e${++n}`,
  date: `${month}-05`,
  type: "outflow",
  account: "ХААН банк MNT",
  counterpart: "Бета ХХК",
  article: "",
  memo: "",
  document: "Банкны зарлага",
  docType: "СписаниеСРасчетногоСчета",
  ref: `0000000${n}`.slice(-8) + "-0000-0000-0000-000000000000",
  amount: 1000,
  counterAccount: "3101",
  counterAccountName: "Дансны өглөг",
  ...over,
});

const SECRET_NAME = "Дорж Болд";
const SECRET_MEMO = "Дорж Болд 9 сарын цалин";
function makeCash(): CashResult {
  const entries = [
    entry({ type: "inflow", counterpart: "Альфа ХХК", counterAccount: "3201", amount: 5000 }),
    entry({ counterpart: "Бета ХХК", amount: 2000, memo: "тээвэр" }),
    entry({ counterpart: SECRET_NAME, memo: SECRET_MEMO, counterAccount: "3342", counterAccountName: "Цалингийн өглөг", amount: 700, payroll: true }),
  ];
  return {
    month,
    asOf: `${month}-19`,
    totals: { opening: 100, inflow: 5000, outflow: 2700, internal: 900, closing: 2400, expectedClosing: 2400, difference: 0, entries: 4 },
    accounts: [],
    daily: [],
    payroll: { inflow: 0, outflow: 700, byDay: [{ date: `${month}-05`, type: "outflow", account: "ХААН банк MNT", amount: 700 }] },
    byCounterpart: [],
    transfers: [entry({ type: "internal", account: "ХААН банк MNT", counterpart: "ХААН банк 2", amount: 900, counterAccount: "" })],
    recent: [],
    entries,
  };
}

beforeAll(async () => {
  const mk = (id: string, role: "ADMIN" | "DIRECTOR" | "EMPLOYEE", canViewPayroll = false) =>
    prisma.user.upsert({ where: { id }, update: { role, isActive: true, canViewPayroll }, create: { id, email: `${id}@test.local`, name: id, role, passwordHash: "x", canViewPayroll } });
  await Promise.all([mk(ids.director, "DIRECTOR"), mk(ids.payrollDirector, "DIRECTOR", true), mk(ids.admin, "ADMIN"), mk(ids.employee, "EMPLOYEE")]);
});
beforeEach(async () => {
  fixture.current = makeCash();
  await prisma.onecCashCategoryRule.deleteMany({});
});
afterAll(async () => {
  await prisma.onecCashCategoryRule.deleteMany({});
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: Object.values(ids) } }, { entityId: { startsWith: P } }] } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
});

describe("/api/dashboard/cash/report", () => {
  it("эрхгүй хүнд 401/403", async () => {
    as(null);
    expect((await REPORT(get(`/api/dashboard/cash/report?month=${month}`))).status).toBe(401);
    as("employee");
    expect((await REPORT(get(`/api/dashboard/cash/report?month=${month}`))).status).toBe(403);
  });

  it("4 том тоо, ангилал, дотоод шилжүүлэг тусад нь", async () => {
    as("director");
    const res = await REPORT(get(`/api/dashboard/cash/report?month=${month}`));
    expect(res.status).toBe(200);
    const r = await res.json();
    expect(r.totals).toMatchObject({ opening: 100, inflow: 5000, outflow: 2700, closing: 2400 });
    expect(r.inflow.categories.map((c: { id: string }) => c.id)).toEqual(["sales"]);
    expect(r.outflow.categories.map((c: { id: string; total: number }) => [c.id, c.total])).toEqual([
      ["suppliers", 2000],
      ["payroll", 700],
    ]);
    expect(r.internal).toMatchObject({ total: 900, count: 1 });
  });

  it("цалингийн эрхгүй хүнд нэр, утга, данс гарахгүй (нийт дүн ижил); эрхтэй хүнд харагдана", async () => {
    as("director");
    const hidden = JSON.stringify(await (await REPORT(get(`/api/dashboard/cash/report?month=${month}`))).json());
    expect(hidden).not.toContain("Дорж");
    expect(hidden).toContain("Цалин олголт (нэгтгэсэн)");
    as("payrollDirector");
    const shown = JSON.stringify(await (await REPORT(get(`/api/dashboard/cash/report?month=${month}`))).json());
    expect(shown).toContain(SECRET_NAME);
  });

  it("админы дүрэм ангиллыг өөрчилнө; ирээдүйн сар 400", async () => {
    await prisma.onecCashCategoryRule.create({ data: { direction: "OUT", field: "PARTY", pattern: "бета", category: "utilities", priority: 1 } });
    as("director");
    const r = await (await REPORT(get(`/api/dashboard/cash/report?month=${month}`))).json();
    expect(r.outflow.categories.find((c: { id: string }) => c.id === "utilities").total).toBe(2000);
    expect((await REPORT(get("/api/dashboard/cash/report?month=2999-01"))).status).toBe(400);
  });
});

describe("/api/dashboard/cash/entries", () => {
  const list = async (qs: string) => (await ENTRIES(get(`/api/dashboard/cash/entries?month=${month}&${qs}`))).json();

  it("хайлт: харилцагч, утга, дүн; хуудаслалт; нягтлангийн лавлагаа зөвхөн мөрийн дотор", async () => {
    as("director");
    const all = await list("");
    expect(all.total).toBe(3);
    expect(await list("q=альфа")).toMatchObject({ total: 1 });
    expect((await list("q=5000")).items[0]).toMatchObject({ counterpart: "Альфа ХХК", categoryLabel: "Борлуулалтын орлого" });
    expect((await list("q=тээвэр")).items[0].accounting).toMatchObject({ document: "Банкны зарлага", account: "3101" });
    expect((await list("q=тээвэр")).items[0].accounting.documentNumber).toMatch(/^УБ00-/);
    expect(await list("flow=inflow")).toMatchObject({ total: 1, netTotal: 5000 });
    expect(await list("category=suppliers&size=10")).toMatchObject({ total: 1, pages: 1 });
  });

  it("200-аас олон гүйлгээ хуудаслагдаж, бүгд хайгдана", async () => {
    const cash = makeCash();
    cash.entries = Array.from({ length: 450 }, (_, i) => entry({ counterpart: `Харилцагч ${i}`, amount: 100 + i }));
    fixture.current = cash;
    as("director");
    const first = await list("size=100");
    expect(first).toMatchObject({ total: 450, pages: 5 });
    expect(first.items).toHaveLength(100);
    expect((await list("q=Харилцагч 449")).total).toBe(1);
    expect((await list("page=5&size=100")).items).toHaveLength(50);
  });

  it("цалингийн эрхгүй хүн нэр, утгаар хайж олохгүй, нэгтгэсэн мөрөнд данс, баримт байхгүй", async () => {
    as("director");
    expect((await list("q=Дорж")).total).toBe(0);
    const agg = (await list("q=цалин олголт")).items;
    expect(agg).toHaveLength(1);
    expect(agg[0]).toMatchObject({ payroll: true, accounting: null, memo: "" });
    expect(JSON.stringify(await list(""))).not.toContain("Дорж");
    as("payrollDirector");
    expect((await list("q=Дорж")).total).toBe(1);
  });

  it("«Комментарий» хариунд хэзээ ч байхгүй", async () => {
    as("payrollDirector");
    const json = JSON.stringify(await list(""));
    expect(json).not.toContain("Комментарий");
    expect(json).not.toContain("comment");
  });
});

describe("шимтгэлийг үндсэн гүйлгээтэй холбох (report, entries)", () => {
  const list = async (qs: string) => (await ENTRIES(get(`/api/dashboard/cash/entries?month=${month}&${qs}`))).json();
  const feeCash = () => {
    const cash = makeCash();
    cash.entries = [
      entry({ id: "main", time: "15:32:49", counterpart: "ZHONGZHI TRADE", memo: "154973.3 CNY НИЙТ ҮНЭ", amount: 84_073_015.25 }),
      entry({ id: "f1", time: "15:33:23", counterpart: "Удирдлагын зардал", counterAccount: "7000", article: "Банкны шимтгэл", memo: "Гадаад гүйлгээний шимтгэл", amount: 20_000 }),
      entry({ id: "f2", time: "15:33:35", counterpart: "Удирдлагын зардал", counterAccount: "7000", article: "Банкны шимтгэл", memo: "Гадаад гүйлгээний шимтгэл", amount: 27_016.5 }),
      entry({ id: "f3", time: "09:00:00", counterpart: "Удирдлагын зардал", counterAccount: "7000", article: "Банкны шимтгэл", memo: "данс хөтөлсний хураамж", amount: 800 }),
    ];
    return cash;
  };

  it("report: гадаад гүйлгээний шимтгэл, холбогдсон/холбогдоогүй, аль төлбөрт хамаарах; ангиллын нийлбэр өөрчлөгдөөгүй", async () => {
    fixture.current = feeCash();
    as("director");
    const r = await (await REPORT(get(`/api/dashboard/cash/report?month=${month}`))).json();
    expect(r.fees.foreign).toEqual({ count: 2, total: 47_016.5 });
    expect(r.fees.linked).toEqual({ count: 2, total: 47_016.5 });
    expect(r.fees.unlinked).toEqual({ count: 1, total: 800 });
    expect(r.fees.byMain).toEqual([expect.objectContaining({ counterpart: "ZHONGZHI TRADE", fee: 47_016.5, count: 2 })]);
    expect(r.outflow.categories.find((c: { id: string }) => c.id === "bankfee").total).toBe(47_816.5); // шимтгэл нэг л удаа
    expect(r.outflow.total).toBeCloseTo(84_073_015.25 + 47_816.5, 2);
  });

  it("entries: үндсэн гүйлгээнд шимтгэл, нийт зарлага; шимтгэлд холбоо; шүүлтүүд", async () => {
    fixture.current = feeCash();
    as("director");
    const all = await list("size=50");
    const main = all.items.find((i: { id: string }) => i.id === "main");
    expect(main.fees).toMatchObject({ count: 2, total: 47_016.5, grandTotal: 84_120_031.75 });
    expect(all.items.find((i: { id: string }) => i.id === "f1")).toMatchObject({ linkedTo: { counterpart: "ZHONGZHI TRADE" }, foreignFee: true });
    expect(all.items.find((i: { id: string }) => i.id === "f3")).toMatchObject({ linkedTo: null, foreignFee: false });
    expect((await list("fee=unlinked")).items.map((i: { id: string }) => i.id)).toEqual(["f3"]);
    expect((await list("fee=foreign")).total).toBe(2);
    expect((await list("main=main")).items.map((i: { id: string }) => i.id).sort()).toEqual(["f1", "f2", "main"]);
    expect((await list("category=bankfee&q=хураамж&flow=outflow")).total).toBe(1);
    expect(all.netTotal).toBeCloseTo(-(84_073_015.25 + 47_816.5), 2); // давхар тоологдоогүй
  });

  it("шүүсэн жагсаалтад үндсэн гүйлгээ байхгүй ч шимтгэл холбоотой хэвээр", async () => {
    fixture.current = feeCash();
    as("director");
    const only = await list("category=bankfee");
    expect(only.items.find((i: { id: string }) => i.id === "f1").linkedTo).toMatchObject({ id: "main" });
  });
});

describe("/api/admin/cash-rules", () => {
  const valid = { direction: "OUT", field: "PARTY", pattern: "Альфа", category: "utilities", priority: 5 };

  it("зөвхөн ADMIN", async () => {
    for (const who of ["director", "employee"] as const) {
      as(who);
      expect((await RULES_GET()).status, who).toBe(403);
      expect((await RULES_POST(body("POST", valid))).status, who).toBe(403);
    }
    as(null);
    expect((await RULES_GET()).status).toBe(403);
  });

  it("нэмэх, засах, устгах: DB-д хадгалагдаж, аудитад бүртгэгдэнэ", async () => {
    as("admin");
    const created = await RULES_POST(body("POST", valid));
    expect(created.status).toBe(201);
    const { id } = await created.json();
    const listed = await (await RULES_GET()).json();
    expect(listed.rules).toHaveLength(1);
    expect(listed.rules[0]).toMatchObject({ pattern: "Альфа", category: "utilities", priority: 5, isActive: true });
    expect(listed.defaults.length).toBeGreaterThan(5); // анхдагч дүрмүүд зөвхөн унших

    expect((await RULE_PATCH(body("PATCH", { category: "loan", isActive: false }), { params: Promise.resolve({ id }) })).status).toBe(200);
    expect(await prisma.onecCashCategoryRule.findUniqueOrThrow({ where: { id } })).toMatchObject({ category: "loan", isActive: false });

    expect((await RULE_DELETE(body("DELETE"), { params: Promise.resolve({ id }) })).status).toBe(200);
    expect(await prisma.onecCashCategoryRule.count()).toBe(0);
    const audits = await prisma.auditLog.findMany({ where: { entityType: "CashCategoryRule", entityId: id }, orderBy: { createdAt: "asc" } });
    expect(audits.map((a) => a.action)).toEqual(["CREATE", "UPDATE", "UPDATE"]);
    expect(JSON.parse(audits[1].beforeJson!)).toMatchObject({ category: "utilities" });
    expect(JSON.parse(audits[2].afterJson!)).toEqual({ deleted: true });
  });

  it("буруу оролт: юу буруу болохыг хэлнэ, юу ч хадгалагдахгүй; байхгүй дүрэм 404", async () => {
    as("admin");
    const bad = async (over: object) => RULES_POST(body("POST", { ...valid, ...over }));
    const r1 = await bad({ pattern: "  " });
    expect(r1.status).toBe(400);
    expect((await r1.json()).error).toBe("Агуулсан үгийг оруулна уу");
    expect((await (await bad({ category: "nope" })).json()).error).toBe("Ангилал буруу байна");
    expect((await (await bad({ field: "X" })).json()).error).toBe("Юуг шалгахыг сонгоно уу");
    expect((await (await bad({ pattern: "x".repeat(81) })).json()).error).toContain("Хэт урт");
    expect(await prisma.onecCashCategoryRule.count()).toBe(0);
    expect((await RULE_PATCH(body("PATCH", { category: "loan" }), { params: Promise.resolve({ id: "missing" }) })).status).toBe(404);
  });
});
