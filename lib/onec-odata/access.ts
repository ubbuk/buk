import { denyPatterns, payrollPatterns, storekeeperAllowPatterns, type EnvLike } from "./config";
import { ODATA_MANAGEMENT_ROLES, ODATA_ROLES, ODATA_STOREKEEPER_ROLE } from "./roles";

export type OdataRoleClass = "management" | "storekeeper";

/** Хүсэлт бүрд DB-ээс уншсан хэрэглэгчийн төлөв (session/JWT-д кэшлэхгүй): lib/onec-odata/viewer.ts */
export interface Viewer {
  role: string;
  canViewPayroll: boolean;
}

export const canUseOdata = (role: string | undefined | null): boolean => !!role && ODATA_ROLES.includes(role);

export function roleClass(role: string | undefined | null): OdataRoleClass | null {
  if (!role) return null;
  if (ODATA_MANAGEMENT_ROLES.includes(role)) return "management";
  if (role === ODATA_STOREKEEPER_ROLE) return "storekeeper";
  return null;
}

const matchesAny = (name: string, patterns: readonly string[]) => {
  const n = name.toLowerCase();
  return patterns.some((p) => n.includes(p.toLowerCase()));
};

export interface ObjectPolicy {
  /** хэн ч харахгүй */
  deny: readonly string[];
  /** зөвхөн canViewPayroll === true хүн харна */
  payroll: readonly string[];
  storekeeperAllow: readonly string[];
}

/** Тохиргоог env-ээс уншина (ONEC_ODATA_DENY, ONEC_ODATA_PAYROLL тохируулаагүй бол OdataConfigError шидэнэ) */
export function loadPolicy(env: EnvLike = process.env): ObjectPolicy {
  return { deny: denyPatterns(env), payroll: payrollPatterns(env), storekeeperAllow: storekeeperAllowPatterns(env) };
}

/**
 * Энэ хэрэглэгч энэ объектыг харж болох уу. Шалгалтын дараалал:
 *   0. Хөтчийн дүр биш бол хэзээ ч үгүй.
 *   1. DENY-д таарвал: хэн ч харахгүй (ADMIN ч, canViewPayroll ч нөлөөлөхгүй).
 *   2. PAYROLL-д таарвал: зөвхөн canViewPayroll === true. Дүрээс үл хамаарна: чагтгүй ADMIN харахгүй, чагттай нярав харна.
 *   3. Бусад нь дүрийн дүрмээр: удирдлага бүгдийг, нярав зөвхөн STOREKEEPER_ALLOW-ийг.
 * Объектын нэрийг ($metadata-д байгаа эсэхийг) энд шалгахгүй: дуудагч тусад нь шалгана.
 */
export function objectAllowed(viewer: Viewer, objectName: string, policy: ObjectPolicy): boolean {
  const cls = roleClass(viewer.role);
  if (!cls) return false;
  if (matchesAny(objectName, policy.deny)) return false;
  if (matchesAny(objectName, policy.payroll)) return viewer.canViewPayroll === true;
  if (cls === "management") return true;
  return matchesAny(objectName, policy.storekeeperAllow);
}
