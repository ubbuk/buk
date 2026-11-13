// 1С OData хөтчийг харах дүрүүд. Edge/клиент аюулгүй: сервер импортгүй, env уншихгүй.
// Удирдлага: хориотой жагсаалтаас бусад бүх объект. Нярав: зөвхөн ONEC_ODATA_STOREKEEPER_ALLOW-д нийцсэн (агуулах/бараа материал) объект.
export const ODATA_MANAGEMENT_ROLES: readonly string[] = ["ADMIN", "DIRECTOR", "CHIEF_ACCOUNTANT", "BOSS"];
export const ODATA_STOREKEEPER_ROLE = "STOREKEEPER";
// ХӨТӨЧИД ОРОХ эрх: зөвхөн ADMIN (цэс, /onec хуудас, /api/onec-odata/*). Объектыг дүрээр ангилах дүрэм (management/storekeeper,
// DENY, PAYROLL) access.ts-д хэвээр: хөтчид нэвтэрсэн ADMIN-д л хэрэглэгдэнэ.
export const ODATA_ROLES: readonly string[] = ["ADMIN"];
