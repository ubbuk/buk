import { describe, expect, it } from "vitest";
import { isRequestHiddenFrom, requestScopeWhere } from "./request-visibility";

const step = (type: string, status: string, assignedUserId: string, decidedById: string | null = null) => ({
  type,
  status,
  assignedUserId,
  decidedById,
});
const make = (warehouse: string, late: string, headId = "head", requestedById = "emp") => ({
  requestedById,
  department: { headId },
  approvalSteps: [
    step("DEPARTMENT_HEAD", "APPROVED", headId),
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

describe("EMPLOYEE sees only their own requests", () => {
  const request = make("PENDING", "PENDING", "head", "emp-a");

  it("shows an employee the requests they created", () => {
    expect(isRequestHiddenFrom(request, "emp-a", "EMPLOYEE")).toBe(false);
  });
  it("hides a colleague's request from another employee (same department or not)", () => {
    expect(isRequestHiddenFrom(request, "emp-b", "EMPLOYEE")).toBe(true);
  });
  it("hides it even if the employee is named on a step", () => {
    const named = make("PENDING", "PENDING", "head", "emp-a");
    named.approvalSteps[1] = step("WAREHOUSE_CHECK", "PENDING", "emp-b");
    expect(isRequestHiddenFrom(named, "emp-b", "EMPLOYEE")).toBe(true);
  });
});

describe("department isolation (Beton vs Mechanic)", () => {
  const mechanicRequest = make("PENDING", "PENDING", "mech-head", "mech-emp");
  const betonRequest = make("PENDING", "PENDING", "beton-head", "beton-emp");

  it("hides a Mechanic request from the Beton head and Beton employees", () => {
    expect(isRequestHiddenFrom(mechanicRequest, "beton-head", "BOSS")).toBe(true);
    expect(isRequestHiddenFrom(mechanicRequest, "beton-emp", "EMPLOYEE")).toBe(true);
  });
  it("shows it to the Mechanic head and its requester only", () => {
    expect(isRequestHiddenFrom(mechanicRequest, "mech-head", "BOSS")).toBe(false);
    expect(isRequestHiddenFrom(mechanicRequest, "mech-emp", "EMPLOYEE")).toBe(false);
    expect(isRequestHiddenFrom(mechanicRequest, "mech-colleague", "EMPLOYEE")).toBe(true);
  });
  it("a BOSS who is not the department's head sees only their own requests", () => {
    expect(isRequestHiddenFrom(betonRequest, "other-boss", "BOSS")).toBe(true);
    expect(isRequestHiddenFrom(make("PENDING", "PENDING", "beton-head", "other-boss"), "other-boss", "BOSS")).toBe(false);
  });
  it("keeps Beton requests visible to the Beton head, hidden from Mechanic", () => {
    expect(isRequestHiddenFrom(betonRequest, "beton-head", "BOSS")).toBe(false);
    expect(isRequestHiddenFrom(betonRequest, "mech-head", "BOSS")).toBe(true);
  });
  it("preserves cross-department access for warehouse, engineering, finance, accounting, manager and admin", () => {
    for (const role of ["STOREKEEPER", "ENGINEERING", "DIRECTOR", "CHIEF_ACCOUNTANT", "MANAGER", "ADMIN"]) {
      expect(isRequestHiddenFrom(mechanicRequest, `unassigned-${role}`, role)).toBe(false);
    }
  });
  it("lets an assigned global approver in, and keeps the stage 3-6 restriction", () => {
    expect(isRequestHiddenFrom(make("PENDING", "PENDING", "mech-head"), "fin", "DIRECTOR")).toBe(true);
    expect(isRequestHiddenFrom(make("APPROVED", "PENDING", "mech-head"), "fin", "DIRECTOR")).toBe(false);
  });
  it("lets a former head who already decided a step keep seeing it, but not an outgoing head who did not", () => {
    const decided = make("PENDING", "PENDING", "new-head");
    decided.approvalSteps[0] = step("DEPARTMENT_HEAD", "APPROVED", "new-head", "old-head");
    expect(isRequestHiddenFrom(decided, "old-head", "BOSS")).toBe(false);

    expect(isRequestHiddenFrom(make("PENDING", "PENDING", "new-head"), "old-head", "BOSS")).toBe(true);
  });
});

describe("requestScopeWhere", () => {
  it("does not restrict global read roles", () => {
    for (const role of ["ADMIN", "DIRECTOR", "MANAGER", "STOREKEEPER", "CHIEF_ACCOUNTANT", "ENGINEERING"]) {
      expect(requestScopeWhere("u", role)).toBeUndefined();
    }
  });
  it("restricts an EMPLOYEE to requests they created", () => {
    expect(requestScopeWhere("u1", "EMPLOYEE")).toEqual({ requestedById: "u1" });
  });
  it("scopes a BOSS to own, headed and assigned requests -- not the whole department", () => {
    expect(requestScopeWhere("u1", "BOSS")).toEqual({
      OR: [
        { requestedById: "u1" },
        { department: { headId: "u1" } },
        { approvalSteps: { some: { OR: [{ assignedUserId: "u1" }, { decidedById: "u1" }] } } },
      ],
    });
  });
});
