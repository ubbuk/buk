// DEMO — stands in for the authenticated session until NextAuth is wired up
// in Phase 3. The request form reads the employee/department from here so
// users never retype information already on their profile.
export const DEMO_CURRENT_USER = {
  id: "u-tumurbaatar",
  name: "Б.Төмөрбаатар",
  departmentId: "d-concrete",
  departmentName: "Бетон цех",
};

export const DEMO_DEPARTMENTS = [
  { id: "d-concrete", name: "Бетон цех", type: "FACTORY" as const, headName: "Ц.Болд" },
  { id: "d-metal", name: "Металл хийцийн цех", type: "FACTORY" as const, headName: "Д.Пүрэв" },
  { id: "d-mechanic", name: "Механик засвар", type: "FACTORY" as const, headName: "Н.Эрдэнэ" },
  { id: "d-finance", name: "Санхүү, аж ахуй", type: "OFFICE" as const, headName: "О.Мөнхзул" },
  { id: "d-admin", name: "Удирдлага, захиргаа", type: "OFFICE" as const, headName: "Б.Ариунаа" },
];

// Org-wide singleton approval roles (see Settings page). Centralized here so
// the request-creation flow and the settings screen agree on who approves
// what — never hardcode these names elsewhere.
export const DEMO_APPROVERS = {
  OFFICE_APPROVER: "Н.Хүнцэнгэл",
  FACTORY_APPROVER: "Б.Нармандах",
  DIRECTOR: "Хамхоев Магомед",
  WAREHOUSE_CLERK: "Г.Сарнай",
};
