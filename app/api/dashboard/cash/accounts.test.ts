import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { CashResult } from "@/lib/onec/cash";

// «Данснууд» API-ууд (accounts, account), «Бүх гүйлгээ»-ний дансаар шүүлт, шилжүүлгийн нэр, админы тохиргоо, эрх: бодит handler, тусгаарласан тест DB.
// 1С-ийн татаалтыг (loadCash) бэлэн өгөгдлөөр солино; session л солигдоно.
const session = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("next-auth", () => ({ getServerSession: async () => session.current }));
vi.mock("@/lib/onec/cash", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/onec/cash")>();
  const { fixtureInputs } = await import("@/lib/onec/cash-accounts.fixture");
  const cash = real.buildCash(fixtureInputs());
  return { ...real, loadCash: async () => ({ value: cash as CashResult, meta: { fetchedAt: Date.now(), cached: true, stale: false } }) };
});
vi.mock("@/lib/onec/odata-read", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/onec/odata-read")>();
  return { ...real, lookupRows: async (_c: string, keys: string[]) => new Map(keys.map((k) => [k, { Number: `УБ00-${k.slice(-4)}` }])) };
});

import { GET as ACCOUNTS } from "./accounts/route";
import { GET as ACCOUNT } from "./account/route";
import { GET as ENTRIES } from "./entries/route";
import { GET as REPORT } from "./report/route";
import { GET as CASH } from "./route";
import { GET as ADMIN_GET, PUT as ADMIN_PUT } from "@/app/api/admin/cash-accounts/route";
import { K } from "@/lib/onec/cash-accounts.fixture";
import { publicId } from "@/lib/onec/cash-accounts";

const TAG = Date.now().toString(36);
const roles = { director: "DIRECTOR", admin: "ADMIN", storekeeper: "STOREKEEPER", employee: "EMPLOYEE", boss: "BOSS" } as const;
const as = (who: keyof typeof roles | null) => {
  session.current = who ? { user: { id: `cashacc-${TAG}-${who}`, role: roles[who], name: who, email: `${who}@t.local`, departmentId: null } } : null;
};
const get = (path: string) => new Request(`http://localhost${path}`);
const put = (data: unknown) => new Request("http://localhost/x", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
const ID = { main: publicId(K.main), usd: publicId(K.usd), cash: publicId(K.cash), hidden: publicId(K.hidden) };
const keys = Object.values(K);

beforeAll(async () => {
  // аудитын actorId нь бодит хэрэглэгч байх ёстой (FK)
  const mk = (who: keyof typeof roles) => prisma.user.upsert({ where: { id: `cashacc-${TAG}-${who}` }, update: {}, create: { id: `cashacc-${TAG}-${who}`, email: `cashacc-${TAG}-${who}@test.local`, name: who, role: roles[who], passwordHash: "x" } });
  await Promise.all((Object.keys(roles) as (keyof typeof roles)[]).map(mk));
});
const clean = () => prisma.onecCashAccountSetting.deleteMany({ where: { key: { in: keys } } });
beforeEach(async () => {
  as("director");
  await clean();
});
afterAll(async () => {
  await clean();
  await prisma.auditLog.deleteMany({ where: { entityType: "CashAccountSetting", actorId: { startsWith: `cashacc-${TAG}` } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: `cashacc-${TAG}` } } });
});

describe("эрх: Мөнгөн хөрөнгө табыг одоо хардаг хүмүүс л", () => {
  it.each([
    ["accounts", () => ACCOUNTS(get("/x"))],
    ["account", () => ACCOUNT(get(`/x?id=${ID.main}&day=2026-09-07`))],
    ["entries", () => ENTRIES(get(`/x?month=2026-09&accountId=${ID.main}`))],
  ])("%s: нэвтрээгүй 401, нярав, ажилтан 403, захирал 200", async (_n, call) => {
    as(null);
    expect((await call()).status).toBe(401);
    for (const who of ["storekeeper", "employee"] as const) {
      as(who);
      expect((await call()).status, who).toBe(403);
    }
    as("director");
    expect((await call()).status).toBe(200);
  });
  it("админы тохиргоо: зөвхөн ADMIN (GET, PUT)", async () => {
    for (const who of ["director", "boss", "storekeeper"] as const) {
      as(who);
      expect((await ADMIN_GET()).status, who).toBe(403);
      expect((await ADMIN_PUT(put({ items: [] }))).status, who).toBe(403);
    }
    as("admin");
    expect((await ADMIN_GET()).status).toBe(200);
  });
});

describe("GET /accounts: Данснууд", () => {
  it("данс бүр нэг карт, үлдэгдлээр эрэмбэлэгдсэн, нийт = табын эцсийн үлдэгдэл; код, дугаар, «1С» байхгүй", async () => {
    const res = await ACCOUNTS(get("/x"));
    const body = await res.json();
    expect(body.accounts.map((c: { closing: number }) => c.closing)).toEqual([1000, 600, 150, 7]);
    expect(body.total).toBe(1757);
    expect(body.canManage).toBe(false);
    const text = JSON.stringify(body);
    for (const w of ["5003636128", "3096022132", "1С", "Комментарий", "acct:", "bank:", "1101", "1001"]) expect(text, w).not.toContain(w);
    expect(body.accounts[0]).toMatchObject({ title: "ХААН банк ··6128 · MNT", subtitle: null, last4: "6128", currency: "MNT" });
  });
  it("ADMIN бүтэн дугаарыг харна", async () => {
    as("admin");
    const body = await (await ACCOUNTS(get("/x"))).json();
    expect(body.canManage).toBe(true);
    expect(body.accounts[0].number).toBe("5003636128");
  });
  it("админы нэр, нуух, дараалал картанд тусна; нуусан данс нийтэд орно", async () => {
    as("admin");
    const saved = await ADMIN_PUT(
      put({
        items: [
          { key: K.main, name: "Үндсэн данс", hidden: false, sortOrder: null },
          { key: K.hidden, name: "", hidden: true, sortOrder: null },
          { key: K.cash, name: "", hidden: false, sortOrder: 1 },
        ],
      })
    );
    expect(await saved.json()).toEqual({ saved: 3, removed: 0 });
    as("director");
    const body = await (await ACCOUNTS(get("/x"))).json();
    expect(body.accounts.map((c: { title: string }) => c.title)).toEqual(["Касс · MNT", "Үндсэн данс", "ХААН банк ··6139 · USD"]);
    expect(body.accounts[1]).toMatchObject({ title: "Үндсэн данс", subtitle: "ХААН банк ··6128 · MNT" });
    expect(body.hiddenCount).toBe(1);
    expect(body.total).toBe(1757);
  });
});

describe("GET /account: нэг дансны 4 тоо", () => {
  it("өдөр: эхний + орсон − гарсан = эцсийн (шилжүүлэг багтана)", async () => {
    const body = await (await ACCOUNT(get(`/x?id=${ID.main}&day=2026-09-07`))).json();
    expect(body.period).toMatchObject({ from: "2026-09-07", to: "2026-09-07", opening: 1500, inflow: 0, outflow: 500, transfersOut: 200, closing: 1000, fx: null });
    expect(body.account).toMatchObject({ title: "ХААН банк ··6128 · MNT", last4: "6128", currency: "MNT" });
    expect(body.account.number).toBeUndefined();
  });
  it("валютын данс: валютаар ч", async () => {
    const body = await (await ACCOUNT(get(`/x?id=${ID.usd}&day=2026-09-25`))).json();
    expect(body.period).toMatchObject({ opening: 700, outflow: 100, closing: 600, fx: { opening: 175, outflow: 25, closing: 150 } });
  });
  it("сар: month=…; буруу огноо, ирээдүй, олдохгүй данс", async () => {
    const m = await (await ACCOUNT(get(`/x?id=${ID.main}&month=2026-09`))).json();
    expect(m.period).toMatchObject({ from: "2026-09-01", to: "2026-09-30", opening: 500, closing: 1000 });
    expect((await ACCOUNT(get(`/x?id=${ID.main}&day=2999-01-01`))).status).toBe(400);
    expect((await ACCOUNT(get(`/x?id=${ID.main}&day=nope`))).status).toBe(400);
    expect((await ACCOUNT(get(`/x?id=zzz&day=2026-09-07`))).status).toBe(404);
  });
  it("ADMIN бүтэн дугаар, бусад нь сүүлийн 4 орон", async () => {
    as("admin");
    expect((await (await ACCOUNT(get(`/x?id=${ID.main}&day=2026-09-07`))).json()).account.number).toBe("5003636128");
  });
});

describe("GET /entries?accountId: «Бүх гүйлгээ»-ний ИЖИЛ жагсаалт, тэр дансаар шүүгдэнэ", () => {
  const items = async (qs: string) => (await (await ENTRIES(get(`/x?month=2026-09&${qs}`))).json()).items as { id: string; type: string; account: string; counterpart: string; categoryLabel: string; transfer: boolean; amount: number; date: string }[];
  it("валютын данс: орлого + шилжүүлэг (орсон/гарсан), «Шилжүүлэг» гэж тэмдэглэгдэнэ", async () => {
    const rows = await items(`accountId=${ID.usd}`);
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.transfer).map((r) => [r.type, r.amount, r.categoryLabel, r.counterpart])).toEqual([
      ["outflow", 100, "Шилжүүлэг", "→ Касс · MNT"],
      ["inflow", 200, "Шилжүүлэг", "← ХААН банк ··6128"],
    ]);
    expect(rows.every((r) => r.account === "ХААН банк ··6139 (USD)")).toBe(true);
  });
  it("хугацаа (from, to) ба хайлт", async () => {
    expect(await items(`accountId=${ID.usd}&from=2026-09-20&to=2026-09-25`)).toHaveLength(2);
    expect((await items(`accountId=${ID.usd}&flow=outflow`)).map((r) => r.amount)).toEqual([100]);
  });
  it("данс олдохгүй бол 404; дансгүй бол өмнөх «Бүх гүйлгээ» (шилжүүлэггүй) хэвээр", async () => {
    expect((await ENTRIES(get("/x?month=2026-09&accountId=zzz"))).status).toBe(404);
    const all = await items("");
    expect(all.every((r) => !r.transfer)).toBe(true);
    expect(all.map((r) => r.id).sort()).toEqual(["d1:1", "d2:1", "d4:1"]);
  });
  it("нэрийн тохиргоо шилжүүлгийн нэрэнд тусна: «← Үндсэн данс»", async () => {
    as("admin");
    await ADMIN_PUT(put({ items: [{ key: K.main, name: "Үндсэн данс", hidden: false, sortOrder: null }, { key: K.usd, name: "Валютын данс", hidden: false, sortOrder: null }] }));
    as("director");
    const rows = await items(`accountId=${ID.usd}`);
    expect(rows.find((r) => r.transfer && r.type === "inflow")!.counterpart).toBe("← Үндсэн данс");
    expect(rows[0].account).toBe("Валютын данс (USD)");
  });
});

describe("шилжүүлэг: «Хамгийн сүүлийн шилжүүлэг» ойлгомжтой нэртэй, нийт орлого/зарлагад орохгүй", () => {
  it("report: from, to нь нэр; нийт орлого/зарлага өөрчлөгдөхгүй", async () => {
    as("admin");
    await ADMIN_PUT(put({ items: [{ key: K.main, name: "Үндсэн данс", hidden: false, sortOrder: null }, { key: K.usd, name: "Валютын данс", hidden: false, sortOrder: null }] }));
    as("director");
    const body = await (await REPORT(get("/x?month=2026-09"))).json();
    expect(body.internal.items.map((t: { from: string; to: string; amount: number }) => `${t.from} → ${t.to} ${t.amount}`)).toEqual(["Валютын данс (USD) → Касс · MNT 100", "Үндсэн данс → Валютын данс (USD) 200"]);
    expect(body.totals).toMatchObject({ inflow: 1400, outflow: 300, internal: 300 });
    expect(JSON.stringify(body.internal)).not.toContain("5003636");
  });
});

describe("дансны бүтэн дугаар: ADMIN-аас бусдад сүүлийн 4 орон", () => {
  it("/cash: нэр, дугаар, шилжүүлэг далдлагдана; ADMIN-д бүтэн", async () => {
    const other = JSON.stringify(await (await CASH(get("/x?month=2026-09"))).json());
    expect(other).not.toContain("5003636128");
    expect(other).toContain("··6128");
    as("admin");
    expect(JSON.stringify(await (await CASH(get("/x?month=2026-09"))).json())).toContain("5003636128");
  });
  it("/entries (дансгүй): данс нэр далдлагдана", async () => {
    const text = JSON.stringify(await (await ENTRIES(get("/x?month=2026-09"))).json());
    expect(text).not.toContain("5003636");
  });
});

describe("PUT /admin/cash-accounts: шалгалт, хадгалалт", () => {
  it("буруу түлхүүр, урт нэр, дараалал → 400", async () => {
    as("admin");
    expect((await ADMIN_PUT(put({ items: [{ key: "x:1", name: "", hidden: false, sortOrder: null }] }))).status).toBe(400);
    expect((await ADMIN_PUT(put({ items: [{ key: K.main, name: "я".repeat(61), hidden: false, sortOrder: null }] }))).status).toBe(400);
    expect((await ADMIN_PUT(put({ items: [{ key: K.main, name: "", hidden: false, sortOrder: 0 }] }))).status).toBe(400);
    expect((await ADMIN_PUT(put({}))).status).toBe(400);
  });
  it("нэргүй, нуугаагүй, дараалалгүй мөр устгагдаж анхдагч руу буцна; аудитад бүртгэгдэнэ", async () => {
    as("admin");
    const audits = () => prisma.auditLog.count({ where: { entityType: "CashAccountSetting", actorId: `cashacc-${TAG}-admin` } });
    const before = await audits();
    await ADMIN_PUT(put({ items: [{ key: K.main, name: "Үндсэн данс", hidden: false, sortOrder: 2 }] }));
    expect(await prisma.onecCashAccountSetting.count({ where: { key: K.main } })).toBe(1);
    const res = await ADMIN_PUT(put({ items: [{ key: K.main, name: "  ", hidden: false, sortOrder: null }] }));
    expect(await res.json()).toEqual({ saved: 0, removed: 1 });
    expect(await prisma.onecCashAccountSetting.count({ where: { key: K.main } })).toBe(0);
    expect((await audits()) - before).toBe(2); // хадгалалт бүр нэг аудит
  });
  it("GET: бүтэн дугаартай данснууд ба тохиргоо", async () => {
    as("admin");
    await ADMIN_PUT(put({ items: [{ key: K.hidden, name: "Нуух", hidden: true, sortOrder: 5 }] }));
    const body = await (await ADMIN_GET()).json();
    const row = body.accounts.find((a: { key: string }) => a.key === K.hidden);
    expect(row).toMatchObject({ number: "3096022132", name: "Нуух", hidden: true, sortOrder: 5, id: ID.hidden });
    expect(body.accounts).toHaveLength(4);
  });
});
