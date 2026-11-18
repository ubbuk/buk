// Баримтын эрхийн ЦЭВЭР дүрэм (тестлэгдэнэ): сервер импортгүй. Route-д хэрэглэгчийг уншиж, энэ дүрмээр шалгадаг: doc-access.ts.
// Одоогийн дүрмийг (lib/onec/roles.ts) хэвээр хадгална:
//  * Удирдлага (FINANCE_ROLES): бүх баримт, нягтлангийн бичилт.
//  * Нярав: зөвхөн агуулахын баримт (орлого, шаардах хуудас, хасалт, шилжүүлэг: Агуулах, Зарцуулалт табын), нягтлангийн бичилтгүй.
//  * Цалин, хувь хүний баримт: ONEC_ODATA_PAYROLL-д таарвал зөвхөн User.canViewPayroll; ONEC_ODATA_DENY-д таарвал хэн ч үгүй.
import type { ObjectPolicy } from "@/lib/onec-odata/access";
import { DOC_KINDS, MOVEMENT_KINDS, kindByEntity, type DocKind } from "./doc-kinds";
import { FINANCE_ROLES, STOREKEEPER_ROLE } from "./roles";

/** Няравт нээлттэй төрлүүд: Агуулах, Зарцуулалт табын агуулахын баримтууд (борлуулалт, банк, касс биш) */
export const STOREKEEPER_KINDS: readonly DocKind[] = MOVEMENT_KINDS.filter((k) => k !== "sale");

export interface DocViewer {
  role: string;
  canViewPayroll: boolean;
}

const matchesAny = (name: string, patterns: readonly string[]) => patterns.some((p) => name.toLowerCase().includes(p.toLowerCase()));

/** Цэвэр дүрэм (тестлэгдэнэ): энэ хэрэглэгч энэ төрлийн баримтыг нээж болох уу. type = 1С-ийн баримтын нэр (Document_ угтваргүй). */
export function canOpenDocument(viewer: DocViewer, type: string, policy: ObjectPolicy): boolean {
  const object = `Document_${type}`;
  if (matchesAny(object, policy.deny)) return false;
  if (matchesAny(object, policy.payroll) && viewer.canViewPayroll !== true) return false;
  if (FINANCE_ROLES.includes(viewer.role)) return true;
  if (viewer.role !== STOREKEEPER_ROLE) return false;
  const kind = kindByEntity(type);
  return !!kind && STOREKEEPER_KINDS.includes(kind);
}

/** Төрлийн жагсаалтыг дүрийн эрхээр шүүнэ (жагсаалтад хориотой төрөл огт орохгүй) */
export function allowedKinds(viewer: DocViewer, requested: readonly DocKind[], policy: ObjectPolicy): DocKind[] {
  return requested.filter((k) => canOpenDocument(viewer, DOC_KINDS[k].entity, policy));
}

/** Нягтлангийн бичилт (дансны харьцаа, дүн): зөвхөн удирдлага */
export const canSeePostings = (viewer: DocViewer): boolean => FINANCE_ROLES.includes(viewer.role);
