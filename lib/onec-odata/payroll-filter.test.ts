import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPolicy, type Viewer } from "./access";
import { OdataError } from "./client";
import { queryObject, resetMetadataCache, resolveObject } from "./service";
import { resetAccountBook } from "@/lib/onec/accounts";
import { resetOdataCache } from "@/lib/onec/odata-cache";
import { resetLimits } from "./limits";

// Цалингийн эрхгүй хүнд /onec хөтөч дээр цалингийн дансны бичилт, цалингийн бичилттэй баримт гарахгүй (сервер талын шүүлт).
const SAL = "a3a3a3a3-0000-0000-0000-000000000003";
const NDSH = "a4a4a4a4-0000-0000-0000-000000000004";
const AP = "a5a5a5a5-0000-0000-0000-000000000005";
const NAME = "Бат-Эрдэнэ";

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<edmx:Edmx Version="1.0"><edmx:DataServices><Schema Namespace="StandardODATA">
<EntityType Name="AccountingRegister_Хозрасчетный_RecordType"><Property Name="Recorder" Type="Edm.String"/><Property Name="Period" Type="Edm.DateTime"/>
  <Property Name="AccountDr_Key" Type="Edm.Guid"/><Property Name="AccountCr_Key" Type="Edm.Guid"/><Property Name="Сумма" Type="Edm.Double"/><Property Name="Содержание" Type="Edm.String"/></EntityType>
<EntityType Name="Document_ОперацияБух"><Property Name="Ref_Key" Type="Edm.Guid"/><Property Name="Number" Type="Edm.String"/><Property Name="Date" Type="Edm.DateTime"/><Property Name="Содержание" Type="Edm.String"/></EntityType>
<EntityType Name="Catalog_Склады"><Property Name="Code" Type="Edm.String"/><Property Name="Description" Type="Edm.String"/></EntityType>
<EntityContainer Name="E">
<EntitySet Name="AccountingRegister_Хозрасчетный_RecordType" EntityType="StandardODATA.AccountingRegister_Хозрасчетный_RecordType"/>
<EntitySet Name="Document_ОперацияБух" EntityType="StandardODATA.Document_ОперацияБух"/>
<EntitySet Name="Catalog_Склады" EntityType="StandardODATA.Catalog_Склады"/>
</EntityContainer></Schema></edmx:DataServices></edmx:Edmx>`;

const ENV = {
  ONEC_ODATA_BASE_URL: "http://1c.test/base/odata/standard.odata",
  ONEC_ODATA_USER: "u",
  ONEC_ODATA_PASSWORD: "p",
  ONEC_ODATA_DENY: "Сертификат",
  ONEC_ODATA_PAYROLL: "Сотрудник, Зарплат",
  ONEC_ODATA_STOREKEEPER_ALLOW: "Склад",
};
const policy = loadPolicy(ENV);
const V = (role: string, canViewPayroll = false): Viewer => ({ role, canViewPayroll });
const json = (value: unknown[]) => new Response(JSON.stringify({ value }), { status: 200 });
const decode = (u: string) => decodeURIComponent(u);

let calls: string[] = [];
let respond: (url: string) => Response;

beforeEach(() => {
  resetMetadataCache();
  resetAccountBook();
  resetOdataCache();
  resetLimits();
  calls = [];
  Object.assign(process.env, ENV);
  respond = (url) => {
    const u = decode(url);
    if (u.includes("$metadata")) return new Response(XML, { status: 200 });
    if (u.includes("ChartOfAccounts_Хозрасчетный")) return json([{ Ref_Key: SAL, Code: "3342.00", Description: "Цалингийн өглөг" }, { Ref_Key: NDSH, Code: "3450.00", Description: "НДШ" }, { Ref_Key: AP, Code: "3101.00", Description: "Өглөг" }]);
    // цалингийн бичилттэй баримтын GUID-ууд
    if (u.startsWith("http://1c.test/base/odata/standard.odata/AccountingRegister_Хозрасчетный_RecordType?") && u.includes("$select=Recorder")) return json([{ Recorder: "DOC-PAY" }]);
    if (u.includes("Document_ОперацияБух?")) return json([{ Ref_Key: "doc-pay", Number: "1", Date: "2026-09-10T00:00:00", Содержание: NAME }, { Ref_Key: "doc-ok", Number: "2", Date: "2026-09-11T00:00:00", Содержание: "Бусад" }]);
    return json([{ Period: "2026-09-10T00:00:00", AccountDr_Key: AP, AccountCr_Key: AP, Сумма: 1, Содержание: "Бусад" }]);
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    calls.push(url);
    return respond(url);
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of Object.keys(ENV)) delete process.env[k];
});

const dataUrl = () => decode(calls.filter((c) => !c.includes("$metadata") && !c.includes("ChartOfAccounts")).pop() ?? "");

describe("/onec: цалингийн бичилтийг серверт шүүнэ", () => {
  it("эрхгүй ADMIN: регистрийн хүсэлтэд цалингийн Дт, Кт дансыг хасах шүүлт орно", async () => {
    const entity = await resolveObject(V("ADMIN"), policy, "AccountingRegister_Хозрасчетный_RecordType");
    await queryObject(V("ADMIN"), policy, entity, { dateFrom: "2026-09-01", dateTo: "2026-09-30" });
    const u = dataUrl();
    for (const k of [SAL, NDSH]) {
      expect(u).toContain(`AccountDr_Key ne guid'${k}'`);
      expect(u).toContain(`AccountCr_Key ne guid'${k}'`);
    }
    expect(u).not.toContain(AP);
    expect(u).toContain("Period ge datetime'2026-09-01T00:00:00'"); // хэрэглэгчийн шүүлт хэвээр
  });

  it("эрхтэй хэрэглэгчид шүүлт орохгүй, дансны төлөвлөгөөг ч татахгүй", async () => {
    const entity = await resolveObject(V("ADMIN", true), policy, "AccountingRegister_Хозрасчетный_RecordType");
    await queryObject(V("ADMIN", true), policy, entity, { dateFrom: "2026-09-01", dateTo: "2026-09-30" });
    expect(dataUrl()).not.toContain(" ne guid'");
    expect(calls.some((c) => decode(c).includes("ChartOfAccounts"))).toBe(false);
  });

  it("баримт: цалингийн бичилттэй баримт (ОперацияБух) жагсаалтаас хасагдаж, хүний нэр 0; эрхтэйд харагдана", async () => {
    const entity = await resolveObject(V("ADMIN"), policy, "Document_ОперацияБух");
    const page = await queryObject(V("ADMIN"), policy, entity, { dateFrom: "2026-09-01", dateTo: "2026-09-30" });
    expect(page.rows.map((r) => r.Number)).toEqual(["2"]);
    expect(JSON.stringify(page)).not.toContain(NAME);

    resetLimits();
    const full = await queryObject(V("ADMIN", true), policy, entity, { dateFrom: "2026-09-01", dateTo: "2026-09-30" });
    expect(full.rows.map((r) => r.Number)).toEqual(["1", "2"]);
    expect(JSON.stringify(full)).toContain(NAME);
  });

  it("цалингийн данс тодорхойлогдохгүй бол өгөгдөл өгөхгүй (fail-closed)", async () => {
    const orig = respond;
    respond = (url) => (decode(url).includes("ChartOfAccounts_Хозрасчетный") ? json([{ Ref_Key: AP, Code: "3101.00", Description: "Өглөг" }]) : orig(url));
    const entity = await resolveObject(V("ADMIN"), policy, "AccountingRegister_Хозрасчетный_RecordType");
    await expect(queryObject(V("ADMIN"), policy, entity, {})).rejects.toBeInstanceOf(OdataError);
    expect(calls.some((c) => decode(c).includes("RecordType?"))).toBe(false);
  });

  it("цалинтай хамааралгүй объект (лавлах) шүүлтгүй, нэмэлт дуудлагагүй", async () => {
    const entity = await resolveObject(V("ADMIN"), policy, "Catalog_Склады");
    await queryObject(V("ADMIN"), policy, entity, {});
    expect(calls.some((c) => decode(c).includes("ChartOfAccounts"))).toBe(false);
    expect(dataUrl()).not.toContain(" ne guid'");
  });
});
