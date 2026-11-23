import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Эрхийн шалгалт (сервер дээр, DB-ээс): дүр БА canViewPayroll. 1С-ийн өгөгдлийн давхарга дуурайлга; Postgres жинхэнэ (туршилтын).
const session = vi.hoisted(() => ({ current: null as unknown }));
const data = vi.hoisted(() => ({ employees: vi.fn(), departments: vi.fn() }));
vi.mock("next-auth", () => ({ getServerSession: async () => session.current }));
vi.mock("@/lib/onec/payroll", async (orig) => ({ ...(await orig<typeof import("@/lib/onec/payroll")>()), loadPayrollEmployees: data.employees, loadPayrollDepartments: data.departments }));

import { GET as access } from "./access/route";
import { GET as departments } from "./departments/route";
import { GET as employees } from "./employees/route";
import { GET as report } from "./report/route";
import { GET as summary } from "./summary/route";
import { currentYear } from "@/lib/onec/dates";
import { writePayrollMonth } from "@/lib/onec/payroll-store";

const P = "pr-route-";
const roles = ["ADMIN", "DIRECTOR", "CHIEF_ACCOUNTANT", "BOSS", "ENGINEERING", "STOREKEEPER", "MANAGER"] as const;
const YEAR = String(currentYear());
const NAME = "Бат-Эрдэнэ";
const req = (path: string) => new Request(`http://t.local/api/payroll/${path}`);
const as = (role: string | null) => {
  session.current = role ? { user: { id: `${P}${role}`, role, name: role, email: `${P}${role}@t.local`, departmentId: null } } : null;
};
const setFlag = (role: string, v: boolean) => prisma.user.update({ where: { id: `${P}${role}` }, data: { canViewPayroll: v } });

beforeAll(async () => {
  for (const r of roles) await prisma.user.upsert({ where: { id: `${P}${r}` }, update: { role: r, canViewPayroll: false }, create: { id: `${P}${r}`, email: `${P}${r}@test.local`, name: r, role: r, passwordHash: "x" } });
  await prisma.$executeRaw`DELETE FROM onec_payroll_month WHERE month LIKE ${`${YEAR}-%`}`; // туршилтын DB: бусад тест, sync-ийн үлдсэн мөрөөс хамаарахгүй
  await writePayrollMonth({ month: `${YEAR}-01`, accrued: 1000, employerNdsh: 100, employeeNdsh: 80, hhoat: 60, paidBank: 900, paidCash: 5, closingPayable: 20, lines: 4, benefit: 0, sickPay: 0, board: 0, boardNdsh: 0, boardHhoat: 0, boardPaid: 0, otherDeductions: 0 });
});
afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: P } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: P } } });
  await prisma.$executeRaw`DELETE FROM onec_payroll_month WHERE month = ${`${YEAR}-01`}`;
});
beforeEach(async () => {
  data.employees.mockReset();
  data.departments.mockReset();
  data.employees.mockResolvedValue({ value: { year: YEAR, employees: [{ name: NAME }] }, meta: { fetchedAt: Date.now(), cached: false, stale: false } });
  data.departments.mockResolvedValue({ value: { year: YEAR, departments: [] }, meta: { fetchedAt: Date.now(), cached: false, stale: false } });
  for (const r of roles) await setFlag(r, false);
  await prisma.auditLog.deleteMany({ where: { actorId: { startsWith: P } } });
});

const endpoints = { summary: () => summary(req("summary")), report: () => report(req("report")), departments: () => departments(req("departments")), employees: () => employees(req("employees")) };

describe("«Цалин» API: эрх", () => {
  it("нэвтрээгүй бол 401", async () => {
    as(null);
    for (const [n, call] of Object.entries(endpoints)) expect((await call()).status, n).toBe(401);
    expect(data.employees).not.toHaveBeenCalled();
  });

  it("canViewPayroll-гүй хэрэглэгч (ADMIN ч) 403: өгөгдөл, 1С, audit огт үгүй", async () => {
    for (const role of ["ADMIN", "DIRECTOR", "CHIEF_ACCOUNTANT", "BOSS"]) {
      as(role);
      for (const [n, call] of Object.entries(endpoints)) {
        const res = await call();
        expect(res.status, `${role} ${n}`).toBe(403);
        expect(JSON.stringify(await res.json())).not.toMatch(/months|employees|departments|accrued/);
      }
    }
    expect(data.employees).not.toHaveBeenCalled();
    expect(data.departments).not.toHaveBeenCalled();
    expect(await prisma.auditLog.count({ where: { actorId: { startsWith: P }, entityType: "PayrollEmployees" } })).toBe(0);
  });

  it("canViewPayroll байгаа ч дүр нь тохирохгүй бол 403", async () => {
    for (const role of ["ENGINEERING", "STOREKEEPER", "MANAGER"]) {
      await setFlag(role, true);
      as(role);
      for (const [n, call] of Object.entries(endpoints)) expect((await call()).status, `${role} ${n}`).toBe(403);
    }
  });

  it("access: зөвхөн {allowed}; дүр БА эрх хоёулаа байвал true", async () => {
    as("ADMIN");
    expect(await (await access()).json()).toEqual({ allowed: false });
    await setFlag("ADMIN", true);
    expect(await (await access()).json()).toEqual({ allowed: true });
    as("MANAGER");
    await setFlag("MANAGER", true);
    expect(await (await access()).json()).toEqual({ allowed: false });
    as(null);
    expect((await access()).status).toBe(401);
  });

  it("эрхийг хүсэлт бүрд DB-ээс уншина: эрхийг хассан даруйд хаагдана", async () => {
    await setFlag("DIRECTOR", true);
    as("DIRECTOR");
    expect((await summary(req("summary"))).status).toBe(200);
    await setFlag("DIRECTOR", false);
    expect((await summary(req("summary"))).status).toBe(403);
  });
});

describe("«Цалин» API: өгөгдөл", () => {
  it("summary: Postgres-ийн сарын нийт дүн; бодолтгүй/татагдаагүй сар тэмдэглэгдэнэ; хүний нэр байхгүй", async () => {
    await setFlag("CHIEF_ACCOUNTANT", true);
    as("CHIEF_ACCOUNTANT");
    const res = await summary(req("summary"));
    const body = await res.json();
    expect(body.year).toBe(YEAR);
    expect(body.months[0]).toMatchObject({ month: `${YEAR}-01`, accrued: 1000, employerNdsh: 100, paidBank: 900, accrualPosted: true, synced: true });
    if (body.months.length > 1) expect(body.months[1]).toMatchObject({ synced: false, accrualPosted: false });
    expect(JSON.stringify(body)).not.toMatch(/employees|name|person/i);
    expect(data.employees).not.toHaveBeenCalled(); // 1С руу хандаагүй
  });

  it("report: сарын задаргаа Postgres-оос (ажил олгогчийн НДШ орно), задаргаагүй сар pending; хүн, хэлтэс байхгүй; 1С руу хандахгүй", async () => {
    await setFlag("DIRECTOR", true);
    as("DIRECTOR");
    const res = await report(req(`report?month=${YEAR}-01`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.month).toBe(`${YEAR}-01`);
    expect(body.months).toHaveLength(12);
    expect(body).toMatchObject({ ready: true, total: 1100, posted: true });
    expect(body.parts.map((p: { id: string; amount: number }) => [p.id, p.amount])).toEqual([["main", 1000], ["benefit", 0], ["sick", 0], ["board", 0], ["employerNdsh", 100]]);
    expect(JSON.stringify(body)).not.toMatch(/"employees"|department|person|"name"/i);
    expect(data.employees).not.toHaveBeenCalled();
    expect((await report(req("report?month=2026-13"))).status).toBe(400);
  });

  it("employees: нээх бүрд audit (хэн, аль он, хэзээ); audit бичигдэхгүй бол өгөгдөл өгөхгүй", async () => {
    await setFlag("ADMIN", true);
    as("ADMIN");
    const res = await employees(req("employees"));
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).toContain(NAME); // эрхтэйд харагдана
    const logs = await prisma.auditLog.findMany({ where: { actorId: `${P}ADMIN`, entityType: "PayrollEmployees" } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ entityId: YEAR, action: "ONEC_ODATA_VIEW" });
    expect(JSON.parse(logs[0].afterJson ?? "{}")).toMatchObject({ year: YEAR });
    expect(logs[0].createdAt).toBeInstanceOf(Date);

    await employees(req("employees"));
    expect(await prisma.auditLog.count({ where: { actorId: `${P}ADMIN`, entityType: "PayrollEmployees" } })).toBe(2); // cache-ээс ч нээлт бүр бүртгэгдэнэ

    data.employees.mockClear();
    const spy = vi.spyOn(prisma.auditLog, "create").mockRejectedValueOnce(new Error("db down"));
    const denied = await employees(req("employees"));
    spy.mockRestore();
    expect(denied.status).toBe(503);
    expect(JSON.stringify(await denied.json())).not.toContain(NAME);
    expect(data.employees).not.toHaveBeenCalled();
  });

  it("year буруу, эсвэл баазгүй он бол 400", async () => {
    await setFlag("ADMIN", true);
    as("ADMIN");
    for (const y of ["abcd", "2020", "20260"]) expect((await summary(req(`summary?year=${y}`))).status, y).toBe(400);
  });
});
