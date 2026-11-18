import { describe, expect, it } from "vitest";
import { allowedKinds, canOpenDocument, canSeePostings, STOREKEEPER_KINDS } from "./doc-rules";
import { DOC_KIND_KEYS, DOC_KINDS, entityLabel, entityOfRecorderType, entityTone, kindByEntity } from "./doc-kinds";
import type { ObjectPolicy } from "@/lib/onec-odata/access";

// ONEC_ODATA_DENY / ONEC_ODATA_PAYROLL-ийн бодит хэлбэр (нэрийн хэсэг, том жижиг үсэг үл ялгана)
const policy: ObjectPolicy = { deny: ["УчетныеЗаписи"], payroll: ["Зарплат", "НачислениеЗП", "Депонир"], storekeeperAllow: [] };
const viewer = (role: string, canViewPayroll = false) => ({ role, canViewPayroll });

describe("баримтын эрх: одоогийн дүрмээр", () => {
  it("удирдлага бүх хэвийн баримтыг нээнэ, нярав зөвхөн агуулахынхыг (борлуулалт, банк, касс биш)", () => {
    for (const role of ["ADMIN", "DIRECTOR", "CHIEF_ACCOUNTANT", "BOSS", "ENGINEERING"]) {
      for (const k of DOC_KIND_KEYS) expect(canOpenDocument(viewer(role), DOC_KINDS[k].entity, policy), `${role} ${k}`).toBe(true);
    }
    expect(STOREKEEPER_KINDS).toEqual(["receipt", "requisition", "writeoff", "transfer"]);
    for (const k of DOC_KIND_KEYS) expect(canOpenDocument(viewer("STOREKEEPER"), DOC_KINDS[k].entity, policy), k).toBe(STOREKEEPER_KINDS.includes(k));
  });

  it("нярав тодорхойгүй төрлийн баримт (бичилтээс ирсэн) нээж чадахгүй", () => {
    expect(canOpenDocument(viewer("STOREKEEPER"), "ОперацияБух", policy)).toBe(false);
  });

  it("бусад дүр (хүсэлт гаргагч, нярав биш) юу ч нээхгүй", () => {
    for (const role of ["USER", "MANAGER", "DEPARTMENT_HEAD", ""]) expect(canOpenDocument(viewer(role), "ПоступлениеТоваровУслуг", policy)).toBe(false);
  });

  it("цалингийн баримт: зөвхөн canViewPayroll; ADMIN ч чагтгүй бол үгүй, чагттай нярав ч харна", () => {
    expect(canOpenDocument(viewer("ADMIN"), "НачислениеЗПГодовая", policy)).toBe(false);
    expect(canOpenDocument(viewer("DIRECTOR", true), "НачислениеЗПГодовая", policy)).toBe(true);
    expect(canOpenDocument(viewer("CHIEF_ACCOUNTANT"), "ВедомостьНаВыплатуЗарплатыВБанк", policy)).toBe(false);
    expect(canOpenDocument(viewer("STOREKEEPER", true), "НачислениеЗПГодовая", policy)).toBe(false); // чагттай нярав ч агуулахын бус баримтыг нээхгүй
  });

  it("хориотой (DENY) баримтыг хэн ч, canViewPayroll ч нээхгүй", () => {
    expect(canOpenDocument(viewer("ADMIN", true), "УчетныеЗаписи", policy)).toBe(false);
  });

  it("жагсаалт: хориотой төрлийг дүрээр хасна; нягтлангийн бичилт зөвхөн удирдлагад", () => {
    expect(allowedKinds(viewer("STOREKEEPER"), [...DOC_KIND_KEYS], policy)).toEqual(["receipt", "requisition", "writeoff", "transfer"]);
    expect(allowedKinds(viewer("DIRECTOR"), [...DOC_KIND_KEYS], policy)).toHaveLength(DOC_KIND_KEYS.length);
    expect(canSeePostings(viewer("DIRECTOR"))).toBe(true);
    expect(canSeePostings(viewer("STOREKEEPER"))).toBe(false);
  });
});

describe("баримтын төрлийн нэр, өнгө", () => {
  it("орлого ногоон, зарлага улаан, шилжүүлэг хөх", () => {
    expect(DOC_KINDS.receipt.tone).toBe("in");
    expect(DOC_KINDS.requisition.tone).toBe("out");
    expect(DOC_KINDS.writeoff.tone).toBe("out");
    expect(DOC_KINDS.transfer.tone).toBe("move");
    expect(DOC_KINDS.bank_in.tone).toBe("in");
    expect(DOC_KINDS.bank_out.tone).toBe("out");
  });

  it("хэрэглэгчид харагдах нэрэнд техникийн нэр (Catalog_, Document_, _Key) байхгүй; кирилл 1С-ийн нэр ч гарахгүй", () => {
    for (const k of DOC_KIND_KEYS) expect(DOC_KINDS[k].label).toMatch(/^[Ѐ-ӿ -~]+$/);
    for (const e of ["ПоступлениеТоваровУслуг", "ОперацияБух", "НеИзвестныйДокумент"]) {
      expect(entityLabel(e)).not.toMatch(/Catalog_|Document_|_Key/);
    }
    expect(entityLabel("НеИзвестныйДокумент")).toBe("Бусад баримт");
    expect(entityLabel("ТребованиеНакладная")).toBe("Шаардах хуудас");
    expect(entityTone("НеИзвестныйДокумент")).toBe("other");
  });

  it("1С-ийн Recorder_Type-ээс баримтын нэр, төрөл", () => {
    expect(entityOfRecorderType("StandardODATA.Document_ПеремещениеТоваров")).toBe("ПеремещениеТоваров");
    expect(kindByEntity(entityOfRecorderType("StandardODATA.Document_ПеремещениеТоваров"))).toBe("transfer");
    expect(kindByEntity("ОперацияБух")).toBeNull();
  });
});
