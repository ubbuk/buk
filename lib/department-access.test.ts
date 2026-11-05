import { describe, expect, it } from "vitest";
import { canCreateRequestForDepartment, departmentHeadError } from "./department-access";

describe("canCreateRequestForDepartment", () => {
  it("allows a user to file for their own department only", () => {
    expect(canCreateRequestForDepartment({ role: "EMPLOYEE", departmentId: "mechanic" }, "mechanic")).toBe(true);
    expect(canCreateRequestForDepartment({ role: "EMPLOYEE", departmentId: "beton" }, "mechanic")).toBe(false);
    expect(canCreateRequestForDepartment({ role: "BOSS", departmentId: "beton" }, "mechanic")).toBe(false);
  });
  it("refuses a non-admin who has no department", () => {
    expect(canCreateRequestForDepartment({ role: "EMPLOYEE", departmentId: null }, "mechanic")).toBe(false);
    expect(canCreateRequestForDepartment({ role: "DIRECTOR" }, "mechanic")).toBe(false);
  });
  it("lets ADMIN file for any department (the one explicit exception)", () => {
    expect(canCreateRequestForDepartment({ role: "ADMIN", departmentId: null }, "mechanic")).toBe(true);
    expect(canCreateRequestForDepartment({ role: "ADMIN", departmentId: "beton" }, "mechanic")).toBe(true);
  });
});

describe("departmentHeadError", () => {
  it("accepts an active BOSS", () => {
    expect(departmentHeadError({ role: "BOSS", isActive: true })).toBeNull();
  });
  it("rejects a missing user, an inactive BOSS and any other role", () => {
    expect(departmentHeadError(null)).not.toBeNull();
    expect(departmentHeadError({ role: "BOSS", isActive: false })).not.toBeNull();
    for (const role of ["EMPLOYEE", "ADMIN", "DIRECTOR", "MANAGER", "STOREKEEPER", "ENGINEERING", "CHIEF_ACCOUNTANT"]) {
      expect(departmentHeadError({ role, isActive: true })).not.toBeNull();
    }
  });
});
