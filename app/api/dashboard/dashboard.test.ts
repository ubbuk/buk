import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetOdataCache } from "@/lib/onec/odata-cache";
import { resetNameCache } from "@/lib/onec/odata-read";
import { addMonths, asOfDate, balanceBoundary, currentMonth, monthRange } from "@/lib/onec/dates";
import { isLocked } from "@/lib/onec/refresh";
import { RECEIVABLES_LOCK, writeStage } from "@/lib/onec/receivables-store";

// Бодит handler-ууд тусгаарласан тест DB дээр; session ба 1С руу гарах fetch-ийг л солино.
const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("next-auth", () => ({ getServerSession: async () => session.current }));

import { GET as CASH } from "./cash/route";
import { GET as EXPENSES } from "./expenses/route";
import { POST as REFRESH } from "./refresh/route";
import { GET as RECEIVABLES } from "./receivables/route";
import { GET as STOCK } from "./stock/route";
import { GET as SUMMARY } from "./summary/route";
import { GET as SYNC_STATUS } from "./sync-status/route";
import { GET as USAGE } from "./usage/route";
import { GET as WIP } from "./wip/route";
import { GET as YEAR } from "./year/route";

const ENV = { ONEC_BASE_URL: "http://1c.test/b", ONEC_USER: "u", ONEC_PASSWORD: "p", ONEC_ODATA_BASE_URL: "http://1c.test/b/odata/standard.odata", ONEC_ODATA_USER: "u", ONEC_ODATA_PASSWORD: "p" };
const as = (role: string | null) => {
  session.current = role ? { user: { id: `dash-${role}`, role, name: role, email: `${role}@t.local`, departmentId: null } } : null;
};
const get = (path: string) => new Request(`http://localhost${path}`);
const post = (body: unknown) => new Request("http://localhost/api/dashboard/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const fetchCalls = vi.fn();

const MONTH = "2031-05";
const PREV = "2031-04";
const OLD = "2030-12";
const YR = 2020; // жилийн харагдацын өгөгдөл: ирээдүйн он биш байх ёстой
const ACC_MAIN = "a1a1a1a1-0000-0000-0000-000000000001";
const ACC_VAT = "a2a2a2a2-0000-0000-0000-000000000002";
const ACC_OTHER = "a3a3a3a3-0000-0000-0000-000000000003";
const CUST_A = "c1c1c1c1-0000-0000-0000-00000000000a";
const CUST_B = "c2c2c2c2-0000-0000-0000-00000000000b";
const sale = (date: string, amount: number) => ({ date: new Date(`${date}T00:00:00.000Z`), org: "", itemCode: "x", item: "x", unit: "", qty: 1, amount, vat: 0, cost: 0, clientCode: "", client: "", clientReg: "", dept: "", doc: "dash-year-test", rowType: "" });

beforeAll(async () => {
  await clean();
  const row = (month: string, group: string, account: string, item: string, amount: number, side = "expense") => ({ month, accountGroup: group, account, item, itemCode: "", side, amount });
  await prisma.onecPl.createMany({
    data: [
      row(MONTH, "cogs", "6101.00", "Шон 80*80", 1000),
      row(MONTH, "admin", "7000.00", "Удирдлагын зардал", 300),
      row(MONTH, "weird_group", "7100.00", "Тээвэр", 100), // 1С-ийн үл мэдэгдэх бүлэг: «Бусад»
      row(MONTH, "revenue", "5000.00", "Орлого", 9999, "income"), // зардал биш
      row(PREV, "cogs", "6101.00", "Шон 80*80", 800),
      row(PREV, "admin", "7000.00", "Удирдлагын зардал", 600),
      row(OLD, "admin", "7000.00", "Удирдлагын зардал", 50),
      row(`${YR}-03`, "admin", "7000.00", "Удирдлагын зардал", 100),
      row(`${YR}-04`, "admin", "7000.00", "Удирдлагын зардал", 200),
      row(`${YR - 1}-03`, "admin", "7000.00", "Удирдлагын зардал", 50),
      row(`${YR}-03`, "revenue", "5000.00", "Орлого", 9999, "income"),
    ],
  });
  await prisma.onecSales.createMany({ data: [sale(`${YR}-03-05`, 1000), sale(`${YR}-03-20`, 500), sale(`${YR - 1}-03-05`, 750)] });
});
afterAll(clean);
async function clean() {
  await prisma.onecPl.deleteMany({ where: { month: { in: [MONTH, PREV, OLD, "2031-03", "2031-02", "2030-12", `${YR}-03`, `${YR}-04`, `${YR - 1}-03`] } } });
  await prisma.onecSales.deleteMany({ where: { doc: "dash-year-test" } });
}
beforeEach(() => {
  resetOdataCache();
  resetNameCache();
  fetchCalls.mockClear();
  Object.assign(process.env, ENV);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      fetchCalls(url, init);
      const u = decodeURIComponent(url);
      if (u.includes("/hs/dash/stock")) return new Response(JSON.stringify({ rows: [], count: 0, generated: "x" }), { status: 200 });
      if (u.includes("ChartOfAccounts_")) return new Response(JSON.stringify({ value: [{ Ref_Key: ACC_MAIN, Code: "1201.00", Description: "Худалдан авагчаас авах авлага" }, { Ref_Key: ACC_VAT, Code: "1271.00", Description: "НӨАТ-н авлага" }, { Ref_Key: ACC_OTHER, Code: "1101.00", Description: "Касс" }] }), { status: 200 });
      if (u.includes("/Balance(")) {
        const b = (acc: string, cust: string, amount: number) => ({ Account_Key: acc, ExtDimension1: cust, ExtDimension1_Type: "StandardODATA.Catalog_Контрагенты", СуммаBalance: amount });
        return new Response(JSON.stringify({ value: [b(ACC_MAIN, CUST_A, 700), b(ACC_MAIN, CUST_B, -50), b(ACC_VAT, CUST_A, 70)] }), { status: 200 });
      }
      if (u.includes("Catalog_Контрагенты")) return new Response(JSON.stringify({ value: [{ Ref_Key: CUST_A, Description: "Альфа ХХК" }, { Ref_Key: CUST_B, Description: "Бета ХХК" }] }), { status: 200 });
      return new Response(JSON.stringify({ value: [] }), { status: 200 });
    })
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of Object.keys(ENV)) delete process.env[k];
});

const ROUTES = {
  stock: () => STOCK(get("/api/dashboard/stock")),
  usage: () => USAGE(get(`/api/dashboard/usage?month=${MONTH}`)),
  sales: () => SUMMARY(get(`/api/dashboard/summary?month=${MONTH}`)),
  receivables: () => RECEIVABLES(get(`/api/dashboard/receivables?month=${currentMonth()}`)),
  wip: () => WIP(get(`/api/dashboard/wip?month=${currentMonth()}`)),
  expenses: () => EXPENSES(get(`/api/dashboard/expenses?month=${MONTH}`)),
  yearSales: () => YEAR(get(`/api/dashboard/year?tab=sales&year=${YR}`)),
  yearExpenses: () => YEAR(get(`/api/dashboard/year?tab=expenses&year=${YR}`)),
  cash: () => CASH(get(`/api/dashboard/cash?month=${currentMonth()}`)),
  syncStatus: () => SYNC_STATUS(get(`/api/dashboard/sync-status?month=${MONTH}`)),
  refreshStock: () => REFRESH(post({ kind: "stock" })),
  refreshMonth: () => REFRESH(post({ kind: "month", month: MONTH })),
} as const;

/** Нярав харах: Агуулах, Зарцуулалт (+ зөвхөн цаг харуулдаг төлөв, агуулахын татаалт) */
const STOREKEEPER_OK: (keyof typeof ROUTES)[] = ["stock", "usage", "syncStatus", "refreshStock"];

describe("/api/dashboard/*: эрх табаар", () => {
  it("нэвтрээгүй бол бүх endpoint 401, 1С руу юу ч явахгүй", async () => {
    as(null);
    for (const [name, call] of Object.entries(ROUTES)) expect((await call()).status, name).toBe(401);
    expect(fetchCalls).not.toHaveBeenCalled();
  });

  it("EMPLOYEE, MANAGER бүх endpoint-д 403", async () => {
    for (const role of ["EMPLOYEE", "MANAGER"]) {
      as(role);
      for (const [name, call] of Object.entries(ROUTES)) expect((await call()).status, `${role} ${name}`).toBe(403);
    }
    expect(fetchCalls).not.toHaveBeenCalled();
  });

  it("нярав зөвхөн Агуулах, Зарцуулалтыг (болон зөвхөн цаг харуулдаг төлөв, агуулахын татаалт) авна; Борлуулалт, Авлага, Дуусаагүй үйлдвэрлэл, Зардал, жилийн харагдац, Мөнгөн хөрөнгө, сарын татаалт 403", async () => {
    as("STOREKEEPER");
    for (const [name, call] of Object.entries(ROUTES)) {
      const res = await call();
      expect(STOREKEEPER_OK.includes(name as keyof typeof ROUTES) ? res.status : -1, `STOREKEEPER ${name} (${res.status})`).toBe(STOREKEEPER_OK.includes(name as keyof typeof ROUTES) ? 200 : -1);
      if (!STOREKEEPER_OK.includes(name as keyof typeof ROUTES)) expect(res.status, `STOREKEEPER ${name}`).toBe(403);
    }
  });

  it("удирдлага бүх табыг авна", async () => {
    for (const role of ["ADMIN", "DIRECTOR", "CHIEF_ACCOUNTANT", "BOSS"]) {
      as(role);
      for (const name of ["stock", "usage", "sales", "receivables", "wip", "expenses", "yearSales", "yearExpenses", "cash", "syncStatus"] as const) expect((await ROUTES[name]()).status, `${role} ${name}`).toBe(200);
    }
  });

  it("1С руу гарсан хүсэлт бүр GET (агуулах, зарцуулалтаар шалгав)", async () => {
    as("DIRECTOR");
    await ROUTES.usage();
    await ROUTES.refreshStock();
    expect(fetchCalls).toHaveBeenCalled();
    for (const [, init] of fetchCalls.mock.calls as [string, RequestInit][]) {
      expect(init.method ?? "GET").toBe("GET");
      expect(init.body).toBeUndefined();
    }
  });

  it("буруу сар 400", async () => {
    as("ADMIN");
    expect((await USAGE(get("/api/dashboard/usage?month=2026-13"))).status).toBe(400);
    expect((await EXPENSES(get("/api/dashboard/expenses?month=bad"))).status).toBe(400);
    expect((await REFRESH(post({ kind: "month", month: "2999-01" }))).status).toBe(400); // ирээдүйн сар
    expect((await REFRESH(post({ kind: "nope" }))).status).toBe(400);
  });
});

describe("/api/dashboard/usage: 5 минутын cache", () => {
  it("хоёр дахь нээлт cache-ээс (1С руу дахин хандахгүй); «Шинэчлэх» 60 сек-ээс богино бол cache-ээс", async () => {
    as("STOREKEEPER");
    const a = await (await ROUTES.usage()).json();
    const callsAfterFirst = fetchCalls.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);
    expect(a.meta.cached).toBe(false);
    const b = await (await ROUTES.usage()).json();
    expect(b.meta.cached).toBe(true);
    expect(fetchCalls.mock.calls.length).toBe(callsAfterFirst);
    const r = await (await USAGE(get(`/api/dashboard/usage?month=${MONTH}&refresh=1`))).json();
    expect(r.meta.cached).toBe(true);
    expect(r.meta.retryAfterSeconds).toBeGreaterThan(0);
    expect(fetchCalls.mock.calls.length).toBe(callsAfterFirst);
  });

  it("1С унтарвал ойлгомжтой алдаа (нууц, URL-гүй)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    as("ADMIN");
    const res = await ROUTES.usage();
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toMatch(/1c\.test|boom/);
  });
});

describe("/api/dashboard/expenses: зардал (Postgres)", () => {
  it("зөвхөн зардлын мөр: бүлгээр, өмнөх сартай харьцуулсан %, нийт", async () => {
    as("CHIEF_ACCOUNTANT");
    const r = await (await EXPENSES(get(`/api/dashboard/expenses?month=${MONTH}`))).json();
    expect(r.total).toBe(1400); // 1000 + 300 + 100; орлого (9999) орохгүй
    expect(r.prevTotal).toBe(1400); // 800 + 600
    expect(r.changePct).toBe(0);
    const by = Object.fromEntries(r.groups.map((g: { group: string }) => [g.group, g]));
    expect(by["Борлуулсан бүтээгдэхүүний өртөг"]).toMatchObject({ amount: 1000, prevAmount: 800, changePct: 25 });
    expect(by["Удирдлагын зардал"]).toMatchObject({ amount: 300, prevAmount: 600, changePct: -50 });
    expect(by["Бусад"]).toMatchObject({ amount: 100, prevAmount: 0, changePct: null }); // өмнөх нь 0: % тодорхойгүй
    expect(r.groups.map((g: { share: number }) => g.share)).toEqual([71.4, 21.4, 7.1]);
  });

  it("сүүлийн 6 сар (сонгосон сар сүүлд), данс бүрээр, техникийн код гарахгүй", async () => {
    as("BOSS");
    const r = await (await EXPENSES(get(`/api/dashboard/expenses?month=${MONTH}`))).json();
    expect(r.months.map((m: { month: string }) => m.month)).toEqual(["2030-12", "2031-01", "2031-02", "2031-03", "2031-04", "2031-05"]);
    expect(r.months[0].total).toBe(50);
    expect(r.months[5].total).toBe(1400);
    expect(r.accounts.map((a: { account: string }) => a.account)).toEqual(["6101.00", "7000.00", "7100.00"]);
    expect(r.accounts[0]).toMatchObject({ name: "Шон 80*80", group: "Борлуулсан бүтээгдэхүүний өртөг", amount: 1000 });
    expect(JSON.stringify(r)).not.toMatch(/cogs|weird_group|"admin"|revenue/);
  });

  it("сар хоосон бол 0, өөрчлөлт тодорхойгүй", async () => {
    as("ADMIN");
    const r = await (await EXPENSES(get("/api/dashboard/expenses?month=2031-09"))).json();
    expect(r).toMatchObject({ total: 0, prevTotal: 0, changePct: null, groups: [], accounts: [] });
  });
});

describe("/api/dashboard/receivables: Postgres-ийн агшин зураг (1С-ийг хүлээхгүй)", () => {
  const cleanSnap = () => prisma.$executeRaw`DELETE FROM onec_receivable_balances`;
  const cleanLog = () => prisma.onecSyncLog.deleteMany({ where: { kind: "receivables-odata" } });
  const idle = async () => {
    for (let i = 0; i < 100 && (await isLocked(RECEIVABLES_LOCK)); i++) await new Promise((r) => setTimeout(r, 50));
  };
  beforeEach(async () => {
    await idle();
    await cleanSnap();
    await cleanLog();
  });
  afterAll(async () => {
    await cleanSnap();
    await cleanLog();
  });
  const today = () => asOfDate(currentMonth());

  it("агшин зураггүй бол missing, 1С руу юу ч явахгүй", async () => {
    as("CHIEF_ACCOUNTANT");
    const r = await (await ROUTES.receivables()).json();
    expect(r).toMatchObject({ missing: true, refreshing: false, lastSyncedAt: null });
    expect(fetchCalls).not.toHaveBeenCalled();
  });

  it("агшин зургаас шууд (1С-гүй): 1201 толгой дүн, НӨАТ тусдаа, Топ 10, техникийн нэргүй", async () => {
    await writeStage(today(), "1201", [
      { accountCode: "1201", accountName: "Авлага", customerKey: CUST_A, customer: "Альфа ХХК", balance: 700, customers: 1 },
      { accountCode: "1201", accountName: "Авлага", customerKey: CUST_B, customer: "Бета ХХК", balance: -50, customers: 1 },
    ]);
    await writeStage(today(), "1271", [{ accountCode: "1271", accountName: "НӨАТ-н авлага", customerKey: "", customer: "", balance: 70, customers: 3 }]);
    as("CHIEF_ACCOUNTANT");
    const r = await (await ROUTES.receivables()).json();
    expect(r.missing).toBe(false);
    expect(r.totals).toEqual({ receivable: 650, debit: 700, credit: 50, customers: 2, debtors: 1, vat: 70 });
    expect(r.accounts.map((a: { code: string }) => a.code)).toEqual(["1201", "1271"]);
    expect(r.top).toEqual([{ key: CUST_A, name: "Альфа ХХК", balance: 700, share: 100 }]);
    expect(JSON.stringify(r)).not.toMatch(/Catalog_|_Key|StandardODATA/);
    expect(fetchCalls).not.toHaveBeenCalled();
  });

  it("шинэ өдрийн эхний нээлт: өнөөдрийнх байхгүй бол сарын доторх сүүлийн агшин зургийг харуулна; өнгөрсөн сар яг тэр өдрийнхийг л", async () => {
    const cur = currentMonth();
    const earlier = `${cur}-01`;
    if (today() === earlier) return; // сарын 1-ний өдөр өмнөх өдөр сарын дотор байхгүй
    await writeStage(earlier, "1201", [{ accountCode: "1201", accountName: "Авлага", customerKey: CUST_A, customer: "Альфа ХХК", balance: 5, customers: 1 }]);
    as("ADMIN");
    const r = await (await ROUTES.receivables()).json();
    expect(r.asOf).toBe(earlier);
    const past = addMonths(cur, -1);
    expect((await (await RECEIVABLES(get(`/api/dashboard/receivables?month=${past}`))).json()).missing).toBe(true);
  });

  it("ирээдүйн, буруу сар 400", async () => {
    as("ADMIN");
    expect((await RECEIVABLES(get(`/api/dashboard/receivables?month=${addMonths(currentMonth(), 1)}`))).status).toBe(400);
    expect((await RECEIVABLES(get("/api/dashboard/receivables?month=x"))).status).toBe(400);
  });

  it("ар талын шинэчлэл: хариуг хүлээлгэхгүй (started), данс бүрийг дарааллаар татаж агшин зураг бичнэ; зөвхөн GET, Period нь өнөөдөр", async () => {
    as("DIRECTOR");
    const res = await (await REFRESH(post({ kind: "receivables" }))).json();
    expect(res.status).toBe("started");
    await idle();
    const r = await (await ROUTES.receivables()).json();
    expect(r.missing).toBe(false);
    expect(r.totals).toMatchObject({ receivable: 650, vat: 70 }); // 1272 дансны төлөвлөгөөнд байхгүй: алдаа биш, алгасна
    expect(r.top[0].name).toBe("Альфа ХХК");
    expect(r.lastAttemptOk).toBe(true);
    const balanceCalls = (fetchCalls.mock.calls as [string, RequestInit][]).map(([u]) => decodeURIComponent(u)).filter((u) => u.includes("/Balance("));
    expect(balanceCalls).toHaveLength(2); // 1201, 1271 (1272 байхгүй)
    expect(balanceCalls[0]).toContain(`Period=datetime'${balanceBoundary(today())}'`); // өдрийн эцэс = дараа өдрийн 00:00:00 (23:59:59-ийн бичилтийг оруулахын тулд)
    expect(balanceCalls[0]).toContain("Condition='ExtDimension1_Type eq ''StandardODATA.Catalog_Контрагенты'''");
    for (const [, init] of fetchCalls.mock.calls as [string, RequestInit][]) expect(init.method ?? "GET").toBe("GET");
  });

  it("5 минутын хязгаар: дуусмагц дахин шахвал recent, 1С руу дахин хандахгүй; ажил явах хооронд busy", async () => {
    as("DIRECTOR");
    expect((await (await REFRESH(post({ kind: "receivables" }))).json()).status).toBe("started");
    expect((await (await REFRESH(post({ kind: "receivables" }))).json()).status).toMatch(/busy|recent/);
    await idle();
    const calls = fetchCalls.mock.calls.length;
    const again = await (await REFRESH(post({ kind: "receivables" }))).json();
    expect(again.status).toBe("recent");
    expect(again.retryAfterSeconds).toBeGreaterThan(0);
    expect(fetchCalls.mock.calls.length).toBe(calls);
  });

  it("1С унтарвал хуучин агшин зураг хэвээр, lastAttemptOk=false", async () => {
    await writeStage(today(), "1201", [{ accountCode: "1201", accountName: "Авлага", customerKey: CUST_A, customer: "Альфа ХХК", balance: 9, customers: 1 }]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    as("DIRECTOR");
    expect((await (await REFRESH(post({ kind: "receivables" }))).json()).status).toBe("started");
    await idle();
    const r = await (await ROUTES.receivables()).json();
    expect(r.totals.receivable).toBe(9);
    expect(r.lastAttemptOk).toBe(false);
  });

  it("өнгөрсөн сарыг зөвхөн ADMIN татна", async () => {
    const past = addMonths(currentMonth(), -2);
    as("DIRECTOR");
    expect((await REFRESH(post({ kind: "receivables", month: past }))).status).toBe(403);
    as("STOREKEEPER");
    expect((await REFRESH(post({ kind: "receivables" }))).status).toBe(403);
    expect(fetchCalls).not.toHaveBeenCalled();
  });
});

describe("/api/dashboard/year: бүтэн жил", () => {
  it("зардал: 12 сар, өмнөх он өгөгдөлтэй сар дээр л харьцуулна (өгөгдөлгүй сар null, 0 биш); орлого орохгүй", async () => {
    as("DIRECTOR");
    const r = await (await ROUTES.yearExpenses()).json();
    expect(r.months).toHaveLength(12);
    const by = Object.fromEntries(r.months.map((m: { month: string }) => [m.month, m]));
    expect(by[`${YR}-03`]).toMatchObject({ amount: 100, hasData: true, prevAmount: 50 });
    expect(by[`${YR}-04`]).toMatchObject({ amount: 200, hasData: true, prevAmount: null });
    expect(by[`${YR}-05`]).toMatchObject({ amount: 0, hasData: false, prevAmount: null });
    expect(r).toMatchObject({ total: 300, hasData: true, hasPrev: true, comparedMonths: 1, changePct: 100 }); // зөвхөн 03-р сарыг харьцуулна: 100 vs 50
  });

  it("борлуулалт: сар бүрийн нийлбэр, өмнөх оны харьцуулалт", async () => {
    as("BOSS");
    const r = await (await ROUTES.yearSales()).json();
    expect(r.months.find((m: { month: string }) => m.month === `${YR}-03`)).toMatchObject({ amount: 1500, prevAmount: 750 });
    expect(r).toMatchObject({ total: 1500, changePct: 100 });
  });

  it("өгөгдөлгүй он: hasData=false, өмнөх он байхгүй", async () => {
    as("ADMIN");
    const r = await (await YEAR(get("/api/dashboard/year?tab=expenses&year=2010"))).json();
    expect(r).toMatchObject({ total: 0, hasData: false, hasPrev: false, changePct: null });
  });

  it("буруу tab, он 400; нэвтрээгүй хэрэглэгчид хаалттай", async () => {
    as("ADMIN");
    expect((await YEAR(get("/api/dashboard/year?tab=cash&year=2020"))).status).toBe(400);
    expect((await YEAR(get("/api/dashboard/year?tab=sales&year=20"))).status).toBe(400);
    expect((await YEAR(get(`/api/dashboard/year?tab=sales&year=${Number(currentMonth().slice(0, 4)) + 1}`))).status).toBe(400);
    as(null);
    expect((await ROUTES.yearSales()).status).toBe(401);
  });
});

describe("/api/dashboard/refresh: өнгөрсөн сарыг зөвхөн ADMIN татна", () => {
  const past = () => addMonths(currentMonth(), -3);

  it("өнгөрсөн сар (stock, month) ADMIN биш бол 403, 1С руу юу ч явахгүй", async () => {
    for (const role of ["DIRECTOR", "CHIEF_ACCOUNTANT", "BOSS", "STOREKEEPER"]) {
      as(role);
      expect((await REFRESH(post({ kind: "stock", month: past() }))).status, `${role} stock`).toBe(403);
      if (role !== "STOREKEEPER") expect((await REFRESH(post({ kind: "month", month: past() }))).status, `${role} month`).toBe(403);
    }
    expect(fetchCalls).not.toHaveBeenCalled();
  });

  it("ADMIN өнгөрсөн сарын эцсийн өдрийн агуулахын үлдэгдлийг татна (asof = сарын сүүлийн өдөр, зөвхөн GET)", async () => {
    as("ADMIN");
    const res = await REFRESH(post({ kind: "stock", month: past() }));
    expect(res.status).toBe(200);
    const url = decodeURIComponent((fetchCalls.mock.calls[0] as [string])[0]);
    expect(url).toContain(`asof=${monthRange(past()).to}`);
    expect((fetchCalls.mock.calls[0] as [string, RequestInit])[1].method ?? "GET").toBe("GET");
    await prisma.onecSyncLog.deleteMany({ where: { kind: "stock", period: monthRange(past()).to } });
  });

  it("одоогийн сарын агуулахын татаалт (month өгөхгүй ч) нярав, удирдлагад хэвээр нээлттэй", async () => {
    as("STOREKEEPER");
    expect((await REFRESH(post({ kind: "stock" }))).status).toBe(200);
    as("DIRECTOR");
    expect((await REFRESH(post({ kind: "stock", month: currentMonth() }))).status).toBe(200);
  });
});

describe("/api/dashboard/refresh: Vercel дээр хүнд татаалт GitHub Actions-д (workflow_dispatch), route дотор ажиллахгүй", () => {
  const github = vi.fn();
  let ghStatus = 204;
  const clean = () => prisma.$executeRaw`DELETE FROM onec_sync_lock WHERE name LIKE 'dispatch-%'`;
  beforeEach(async () => {
    github.mockReset();
    ghStatus = 204;
    await clean();
    await prisma.onecSyncLog.deleteMany({ where: { kind: { in: ["sales", "pl", "cash", "receivables-odata"] }, period: { in: [currentMonth(), addMonths(currentMonth(), -2), asOfDate(currentMonth())] } } });
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("GITHUB_DISPATCH_TOKEN", "github_pat_test_token");
    vi.stubEnv("GITHUB_REPOSITORY", "acme/erp");
    const inner = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        if (String(url).startsWith("https://api.github.com/")) {
          github(url, init);
          return new Response(null, { status: ghStatus });
        }
        return inner(url, init);
      })
    );
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await clean();
  });
  const body = (c = 0) => JSON.parse(String((github.mock.calls[c] as [string, RequestInit])[1].body));
  const oneCCalls = () => (fetchCalls.mock.calls as [string][]).filter(([u]) => u.includes("1c.test"));

  it("«Шинэчлэх» (сар): GitHub-ийг нэг удаа дуудаж «dispatched» буцаана, 1С-д route-оос огт хандахгүй; давхар товшилт «busy»", async () => {
    as("DIRECTOR");
    const r = await (await REFRESH(post({ kind: "month", month: currentMonth(), kinds: ["pl"] }))).json();
    expect(r.status).toBe("dispatched");
    expect(Date.parse(r.dispatchedAt)).toBeGreaterThan(Date.now() - 5000);
    expect(github).toHaveBeenCalledTimes(1);
    expect(body()).toEqual({ ref: "main", inputs: { mode: "month", month: currentMonth() } });
    expect(oneCCalls()).toHaveLength(0);
    const again = await (await REFRESH(post({ kind: "month", month: currentMonth(), kinds: ["pl"] }))).json();
    expect(again).toEqual({ status: "busy", via: "actions" });
    expect(github).toHaveBeenCalledTimes(1);
  });

  it("авлагын агшин зураг: mode=receivables, 1С дуудахгүй", async () => {
    as("CHIEF_ACCOUNTANT");
    const r = await (await REFRESH(post({ kind: "receivables", month: currentMonth() }))).json();
    expect(r.status).toBe("dispatched");
    expect(body().inputs).toEqual({ mode: "receivables", month: currentMonth() });
    expect(oneCCalls()).toHaveLength(0);
  });

  it("хуудас нээгдэхэд автоматаар (auto) дуудахгүй: «scheduled», GitHub-д ч хандахгүй", async () => {
    as("DIRECTOR");
    expect((await (await REFRESH(post({ kind: "month", month: currentMonth(), auto: true }))).json()).status).toBe("scheduled");
    expect((await (await REFRESH(post({ kind: "receivables", month: currentMonth(), auto: true }))).json()).status).toBe("scheduled");
    expect(github).not.toHaveBeenCalled();
    expect(oneCCalls()).toHaveLength(0);
  });

  it("өгөгдөл шинэхэн (5 минутын дотор татсан) бол «recent», GitHub-д хандахгүй", async () => {
    await prisma.onecSyncLog.createMany({ data: ["sales", "pl"].map((kind) => ({ kind, period: currentMonth(), ok: true, startedAt: new Date() })) });
    as("DIRECTOR");
    const r = await (await REFRESH(post({ kind: "month", month: currentMonth() }))).json();
    expect(r.status).toBe("recent");
    expect(r.retryAfterSeconds).toBeGreaterThan(0);
    expect(github).not.toHaveBeenCalled();
  });

  it("өнгөрсөн сарыг зөвхөн ADMIN: DIRECTOR 403, ADMIN бол тэр сараар dispatch", async () => {
    const past = addMonths(currentMonth(), -2);
    as("DIRECTOR");
    expect((await REFRESH(post({ kind: "month", month: past }))).status).toBe(403);
    expect(github).not.toHaveBeenCalled();
    as("ADMIN");
    expect((await (await REFRESH(post({ kind: "month", month: past }))).json()).status).toBe("dispatched");
    expect(body().inputs.month).toBe(past);
  });

  it("токен тохируулаагүй бол «unavailable» (товч хуваарийг заана), Агуулах шууд шинэчлэгдсээр", async () => {
    vi.stubEnv("GITHUB_DISPATCH_TOKEN", "");
    await prisma.onecSyncLog.deleteMany({ where: { kind: "stock", period: asOfDate(currentMonth()) } }); // өмнөх тестийн оролдлого 60 секундийн хязгаарт орохгүй
    as("DIRECTOR");
    expect((await (await REFRESH(post({ kind: "month", month: currentMonth() }))).json()).status).toBe("unavailable");
    expect((await (await REFRESH(post({ kind: "receivables", month: currentMonth() }))).json()).status).toBe("unavailable");
    expect(github).not.toHaveBeenCalled();
    const stock = await REFRESH(post({ kind: "stock" }));
    expect(stock.status).toBe(200);
    expect((fetchCalls.mock.calls as [string][]).some(([u]) => u.includes("/hs/dash/stock"))).toBe(true);
    await prisma.onecSyncLog.deleteMany({ where: { kind: "stock", period: asOfDate(currentMonth()) } });
  });

  it("GitHub алдаа өгвөл 502 (токенгүй мессеж), түрээс суллагдсан тул дахин оролдож болно", async () => {
    ghStatus = 500;
    as("DIRECTOR");
    const res = await REFRESH(post({ kind: "month", month: currentMonth() }));
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toMatch(/github_pat|token/i);
    ghStatus = 204;
    expect((await (await REFRESH(post({ kind: "month", month: currentMonth() }))).json()).status).toBe("dispatched");
  });
});

describe("/api/dashboard/summary: өртгийн задаргаа (нийт өртөг, бохир ашиг өөрчлөгдөхгүй)", () => {
  const MON = "2020-06";
  const row = (date: string, rowType: string, amount: number, cost: number) => ({ ...sale(date, amount), doc: "dash-cost-test", rowType, cost });
  beforeAll(async () => {
    await prisma.onecSales.createMany({ data: [row(`${MON}-05`, "sale", 1000, 600), row(`${MON}-06`, "sale", 500, 200), row(`${MON}-07`, "reversal", -100, 0), row(`${MON}-08`, "cost_only", 0, 150)] });
  });
  afterAll(() => prisma.onecSales.deleteMany({ where: { doc: "dash-cost-test" } }));

  it("баримтаар (sale, reversal) ба шаардах хуудсаар шууд өртөгт бичсэн (cost_only) хоёр мөр, нийлбэр нь нийт өртөгтэй тэнцүү", async () => {
    as("DIRECTOR");
    const r = await (await SUMMARY(get(`/api/dashboard/summary?month=${MON}`))).json();
    expect(r.kpi).toMatchObject({ revenue: 1400, cost: 950, cost_documents: 800, cost_requisitions: 150, gross_profit: 450 });
    expect(r.kpi.cost_documents + r.kpi.cost_requisitions).toBe(r.kpi.cost);
  });
});

describe("/api/dashboard/wip: Дуусаагүй үйлдвэрлэл (142x), 1С OData Balance", () => {
  it("үлдэгдэл нийт, данс бүрээр; зөвхөн GET; 5 минутын cache; ирээдүйн сар 400", async () => {
    as("CHIEF_ACCOUNTANT");
    const r = await (await ROUTES.wip()).json();
    expect(r.asOf).toBe(asOfDate(currentMonth()));
    expect(typeof r.total).toBe("number");
    const balanceCall = (fetchCalls.mock.calls as [string, RequestInit][]).map(([u]) => decodeURIComponent(u)).find((u) => u.includes("/Balance("))!;
    expect(balanceCall).toContain(`Period=datetime'${balanceBoundary(asOfDate(currentMonth()))}'`);
    for (const [, init] of fetchCalls.mock.calls as [string, RequestInit][]) expect(init.method ?? "GET").toBe("GET");
    const calls = fetchCalls.mock.calls.length;
    expect((await (await ROUTES.wip()).json()).meta.cached).toBe(true);
    expect(fetchCalls.mock.calls.length).toBe(calls);
    expect((await WIP(get(`/api/dashboard/wip?month=${addMonths(currentMonth(), 1)}`))).status).toBe(400);
  });
});
