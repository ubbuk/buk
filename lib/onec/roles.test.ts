import { describe, expect, it } from "vitest";
import { resolveNavItems } from "@/lib/nav";
import { FINANCE_ROLES, FINANCE_TABS, canViewFinance, canViewTab, rolesForTab } from "./roles";

const ALL_ROLES = ["ADMIN", "DIRECTOR", "CHIEF_ACCOUNTANT", "BOSS", "ENGINEERING", "STOREKEEPER", "MANAGER", "EMPLOYEE"];

describe("1С самбарын табуудын эрх", () => {
  it("удирдлага бүх табыг харна", () => {
    for (const role of ["ADMIN", "DIRECTOR", "CHIEF_ACCOUNTANT", "BOSS"]) {
      for (const tab of FINANCE_TABS) expect(canViewTab(role, tab), `${role} ${tab}`).toBe(true);
    }
  });

  it("нярав зөвхөн Агуулах, Зарцуулалт табыг харна", () => {
    expect(FINANCE_TABS.filter((t) => canViewTab("STOREKEEPER", t))).toEqual(["stock", "usage"]);
    for (const tab of ["products", "sales", "receivables", "expenses", "cash", "production"] as const) expect(canViewTab("STOREKEEPER", tab), tab).toBe(false);
  });

  it("бусад дүр, дүргүй хэрэглэгч юу ч харахгүй", () => {
    for (const role of ["EMPLOYEE", "MANAGER", "", "NOPE", undefined, null]) {
      for (const tab of FINANCE_TABS) expect(canViewTab(role, tab), `${String(role)} ${tab}`).toBe(false);
      expect(canViewFinance(role)).toBe(false);
    }
  });

  it("rolesForTab нь canViewTab-тай ижил", () => {
    for (const tab of FINANCE_TABS) {
      expect([...rolesForTab(tab)].sort(), tab).toEqual(ALL_ROLES.filter((r) => canViewTab(r, tab)).sort());
    }
    expect(FINANCE_ROLES).not.toContain("STOREKEEPER");
  });
});

describe("«Үйлдвэрлэл» таб", () => {
  it("ADMIN, DIRECTOR, ENGINEERING, BOSS, CHIEF_ACCOUNTANT харна; нярав, MANAGER, EMPLOYEE харахгүй", () => {
    for (const role of ["ADMIN", "DIRECTOR", "ENGINEERING", "BOSS", "CHIEF_ACCOUNTANT"]) expect(canViewTab(role, "production"), role).toBe(true);
    for (const role of ["STOREKEEPER", "MANAGER", "EMPLOYEE", undefined]) expect(canViewTab(role, "production"), String(role)).toBe(false);
    expect([...rolesForTab("production")].sort()).toEqual(["ADMIN", "BOSS", "CHIEF_ACCOUNTANT", "DIRECTOR", "ENGINEERING"]);
  });
});

describe("цэс: нэг «1С» цэс", () => {
  const onec = (role: string) => resolveNavItems(role).filter((i) => i.label === "Санхүү");

  it("самбар харах эрхтэй дүр бүрд яг нэг «1С» цэс, хуучин «1С санхүүгийн самбар», «1С хөтөч» цэс байхгүй", () => {
    for (const role of ["ADMIN", "DIRECTOR", "CHIEF_ACCOUNTANT", "BOSS", "ENGINEERING", "STOREKEEPER"]) {
      const items = onec(role);
      expect(items.map((i) => i.label), role).toEqual(["Санхүү"]);
      expect(items[0].href).toBe("/finance");
    }
    for (const role of ["ADMIN", "STOREKEEPER"]) {
      expect(resolveNavItems(role).some((i) => /хөтөч|санхүүгийн самбар/i.test(i.label)), role).toBe(false);
    }
  });

  it("эрхгүй дүрд «1С» цэс байхгүй", () => {
    for (const role of ["EMPLOYEE", "MANAGER"]) expect(onec(role), role).toEqual([]);
  });
});
