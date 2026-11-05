import { describe, expect, it } from "vitest";
import { approvalQueueFor, isStepAssignedTo } from "./approval-queue";
import type { ApprovalStepView, MaterialRequestView } from "./types";

const step = (type: ApprovalStepView["type"], status: ApprovalStepView["status"], assignedUserId: string): ApprovalStepView => ({
  type,
  status,
  assignedUserId,
  assignedUserName: assignedUserId,
});

function request(id: string, departmentHeadId: string | null | undefined, steps: ApprovalStepView[]): MaterialRequestView {
  return { id, departmentHeadId, approvalSteps: steps } as unknown as MaterialRequestView;
}

const pendingAtDepartment = (id: string, headId: string, stepAssignee = headId) =>
  request(id, headId, [
    step("DEPARTMENT_HEAD", "PENDING", stepAssignee),
    step("WAREHOUSE_CHECK", "PENDING", "store"),
    step("BRANCH_APPROVAL", "PENDING", "branch"),
  ]);

describe("approvalQueueFor", () => {
  const beton = pendingAtDepartment("beton-1", "beton-head");
  const mechanic = pendingAtDepartment("mech-1", "mech-head");
  const all = [beton, mechanic];

  it("shows each department head only their own department's requests", () => {
    expect(approvalQueueFor(all, "beton-head", "BOSS").map((r) => r.id)).toEqual(["beton-1"]);
    expect(approvalQueueFor(all, "mech-head", "BOSS").map((r) => r.id)).toEqual(["mech-1"]);
  });
  it("gives an unrelated user an empty queue, and ADMIN the full one", () => {
    expect(approvalQueueFor(all, "someone", "EMPLOYEE")).toEqual([]);
    expect(approvalQueueFor(all, "admin", "ADMIN").map((r) => r.id)).toEqual(["beton-1", "mech-1"]);
  });
  it("does not queue the warehouse check for the storekeeper", () => {
    const atWarehouse = request("w", "h", [
      step("DEPARTMENT_HEAD", "APPROVED", "h"),
      step("WAREHOUSE_CHECK", "PENDING", "store"),
    ]);
    expect(approvalQueueFor([atWarehouse], "store", "STOREKEEPER")).toEqual([]);
  });
  it("does not list a request waiting on the Manager's procurement as an approval, even for ADMIN", () => {
    const atProcurement = request("p", "h", [
      step("DEPARTMENT_HEAD", "APPROVED", "h"),
      step("EXECUTIVE_APPROVAL", "APPROVED", "exec"),
      step("MANAGER_PROCUREMENT", "PENDING", "—"),
    ]);
    expect(approvalQueueFor([atProcurement], "admin", "ADMIN")).toEqual([]);
    expect(approvalQueueFor([atProcurement], "mgr", "MANAGER")).toEqual([]);
  });
  it("queues a late stage for the assignee only once it is the current step", () => {
    const atBranch = request("b", "h", [
      step("DEPARTMENT_HEAD", "APPROVED", "h"),
      step("WAREHOUSE_CHECK", "APPROVED", "store"),
      step("BRANCH_APPROVAL", "PENDING", "branch"),
      step("FINANCE_APPROVAL", "PENDING", "fin"),
    ]);
    expect(approvalQueueFor([atBranch], "branch", "ENGINEERING").map((r) => r.id)).toEqual(["b"]);
    expect(approvalQueueFor([atBranch], "fin", "DIRECTOR")).toEqual([]);
  });
});

describe("isStepAssignedTo (head reassignment)", () => {
  it("recognises the new head even if the step row still names the old one", () => {
    const stale = pendingAtDepartment("r", "new-head", "old-head");
    const pending = stale.approvalSteps[0];
    expect(isStepAssignedTo(stale, pending, "new-head")).toBe(true);
    expect(isStepAssignedTo(stale, pending, "old-head")).toBe(false);
  });
  it("falls back to the step assignee when the request carries no head id", () => {
    const legacy = request("r", undefined, [step("DEPARTMENT_HEAD", "PENDING", "h")]);
    expect(isStepAssignedTo(legacy, legacy.approvalSteps[0], "h")).toBe(true);
  });
  it("uses the assigned user for non-department stages", () => {
    const r = pendingAtDepartment("r", "h");
    expect(isStepAssignedTo(r, r.approvalSteps[2], "branch")).toBe(true);
    expect(isStepAssignedTo(r, r.approvalSteps[2], "h")).toBe(false);
  });
});
