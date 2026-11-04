import { describe, expect, it } from "vitest";
import { isRequestHiddenFrom } from "./request-visibility";

const step = (type: string, status: string, assignedUserId: string) => ({ type, status, assignedUserId });
const make = (warehouse: string, late: string) => ({
  requestedById: "emp",
  department: { headId: "head" },
  approvalSteps: [
    step("DEPARTMENT_HEAD", "APPROVED", "head"),
    step("WAREHOUSE_CHECK", warehouse, "store"),
    step("BRANCH_APPROVAL", late, "branch"),
    step("FINANCE_APPROVAL", late, "fin"),
  ],
});

describe("isRequestHiddenFrom", () => {
  it("hides from stages 3-6 until the warehouse approves", () => {
    expect(isRequestHiddenFrom(make("PENDING", "PENDING"), "branch", "MANAGER")).toBe(true);
  });
  it("hides from stages 3-6 when the warehouse covered everything (SKIPPED)", () => {
    expect(isRequestHiddenFrom(make("APPROVED", "SKIPPED"), "fin", "MANAGER")).toBe(true);
  });
  it("shows to stages 3-6 once the warehouse approved with a shortfall", () => {
    expect(isRequestHiddenFrom(make("APPROVED", "PENDING"), "branch", "MANAGER")).toBe(false);
  });
  it("restricts a DIRECTOR who is also a stage 3-6 approver", () => {
    expect(isRequestHiddenFrom(make("PENDING", "PENDING"), "fin", "DIRECTOR")).toBe(true);
    expect(isRequestHiddenFrom(make("APPROVED", "PENDING"), "fin", "DIRECTOR")).toBe(false);
  });
  it("never hides from requester, department head, storekeeper, admin, unassigned director", () => {
    const r = make("PENDING", "PENDING");
    for (const [id, role] of [["emp", "EMPLOYEE"], ["head", "BOSS"], ["store", "STOREKEEPER"], ["x", "ADMIN"], ["y", "DIRECTOR"]]) {
      expect(isRequestHiddenFrom(r, id, role)).toBe(false);
    }
  });
});
