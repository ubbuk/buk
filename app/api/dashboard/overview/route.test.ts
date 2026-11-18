import { beforeEach, describe, expect, it, vi } from "vitest";

// Эрхийн шалгалт (сервер дээр): session-ийг л солино, өгөгдлийн давхарга дуурайлга.
const session = vi.hoisted(() => ({ current: null as unknown }));
const loader = vi.hoisted(() => vi.fn());
vi.mock("next-auth", () => ({ getServerSession: async () => session.current }));
vi.mock("@/lib/onec/overview", () => ({ loadFinanceOverview: loader }));

import { GET } from "./route";

const as = (role: string | null) => {
  session.current = role ? { user: { id: `ov-${role}`, role, name: role, email: `${role}@t.local`, departmentId: null } } : null;
};
const OVERVIEW = { cards: [{ key: "stock", value: 1, asOf: "2026-11-18", syncedAt: null }], updatedAt: null, stale: false, staleMessage: null };

describe("GET /api/dashboard/overview: эрх", () => {
  beforeEach(() => {
    loader.mockReset();
    loader.mockResolvedValue(OVERVIEW);
  });

  it("нэвтрээгүй бол 401, өгөгдөл уншихгүй", async () => {
    as(null);
    expect((await GET()).status).toBe(401);
    expect(loader).not.toHaveBeenCalled();
  });

  it("ADMIN, DIRECTOR, CHIEF_ACCOUNTANT, BOSS авна", async () => {
    for (const role of ["ADMIN", "DIRECTOR", "CHIEF_ACCOUNTANT", "BOSS"]) {
      as(role);
      const res = await GET();
      expect(res.status, role).toBe(200);
      expect(await res.json()).toEqual(OVERVIEW);
      expect(loader).toHaveBeenLastCalledWith(expect.any(Date), role); // дүрийг дамжуулна: мөнгө, зарцуулалтын карт зөвхөн ADMIN, DIRECTOR-д
    }
  });

  it("бусад дүрд 403, өгөгдөл огт буцахгүй (өгөгдлийн давхарга ч дуудагдахгүй)", async () => {
    for (const role of ["ENGINEERING", "STOREKEEPER", "MANAGER", "EMPLOYEE", "DEPARTMENT_HEAD"]) {
      as(role);
      const res = await GET();
      expect(res.status, role).toBe(403);
      expect(JSON.stringify(await res.json())).not.toContain("cards");
    }
    expect(loader).not.toHaveBeenCalled();
  });
});
