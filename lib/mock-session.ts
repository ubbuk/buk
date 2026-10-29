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
  { id: "d-concrete", name: "Бетон цех", type: "FACTORY" as const },
  { id: "d-metal", name: "Металл хийцийн цех", type: "FACTORY" as const },
  { id: "d-mechanic", name: "Механик засвар", type: "FACTORY" as const },
  { id: "d-finance", name: "Санхүү, аж ахуй", type: "OFFICE" as const },
  { id: "d-admin", name: "Удирдлага, захиргаа", type: "OFFICE" as const },
];
