// «Үйлдвэрлэл» табын картуудын бүтэц: 1С-ийн Parent (эх хэлтэс) биш, ӨӨРСДИЙН тохиргоо. Карт бүр = нэр + 1С-ийн хэлтсийн нэрсийн жагсаалт.
// Хэлтсийг НЭРЭЭР нь (том/жижиг үсэг, цэг тэмдэг, илүү зайг үл тооно) тулгана: 1С-ийн лавлахад ижил нэртэй давхардсан бичлэг
// («Төмөр замын төмөр бетон дэрний хэсэг» ×3) байдаг тул нэг картанд автоматаар нэгдэнэ.
// Тохиргоонд байхгүй хэлтсийн гарц «Бусад» картанд орж, «Тохиргоогүй хэлтэс» шар тэмдэг гарна: шинэ хэлтэс гарвал энд нэмнэ.
// Цэвэр (сервер импортгүй): клиент, сервер хоёулаа ашиглана.
import { normalizeDepartment } from "./production-names";

export interface ProductionGroupConfig {
  /** картын нэр */
  name: string;
  /** энэ картанд орох 1С-ийн хэлтсийн нэрс */
  departments: readonly string[];
  /** гарц нь хагас боловсруулсан (1431, жишээ нь бетон зуурмаг м3): картын гарцад ордог ч бэлэн бүтээгдэхүүний нийт гарцад ордоггүй, «хагас боловсруулсан» гэж тэмдэглэнэ */
  semi?: boolean;
}

/** Картуудын дараалал энэ жагсаалтаар */
export const PRODUCTION_GROUPS: readonly ProductionGroupConfig[] = [
  { name: "Бетон дэрний хэсэг", departments: ["Төмөр замын төмөр бетон дэрний хэсэг"] },
  { name: "Төмөр бетон хийц эдлэлийн цех", departments: ["Төмөр бетон хийц эдлэлийн цех"] },
  { name: "Тенсиланд хэсэг", departments: ["Тенсиланд хэсэг"] },
  { name: "Вольтамиксийн хэсэг", departments: ["Вольтамиксийн хэсэг"] },
  { name: "Бетон зуурмаг (БАЗ-3, БАЗ-4)", departments: ["БАЗ-3", "БАЗ-4"], semi: true },
  { name: "Арматурын хэсэг", departments: ["Арматурын хэсэг"], semi: true },
  { name: "Бутлан ангилах үйлдвэр", departments: ["Бутлан ангилах үйлдвэр"] },
  { name: "Металл хийц", departments: ["Металл хийц үйлдвэрлэлийн цех"] },
];

/** Тохиргоонд байхгүй хэлтсүүд */
export const OTHER_GROUP = "Бусад";

export interface GroupMatch {
  name: string;
  /** тохиргоонд байгаа эсэх (false = «Бусад») */
  configured: boolean;
  semi: boolean;
}

const BY_DEPARTMENT = new Map<string, ProductionGroupConfig>();
for (const g of PRODUCTION_GROUPS) for (const d of g.departments) BY_DEPARTMENT.set(normalizeDepartment(d), g);

/** 1С-ийн хэлтэс -> карт */
export function groupFor(department: string): GroupMatch {
  const g = BY_DEPARTMENT.get(normalizeDepartment(department));
  return g ? { name: g.name, configured: true, semi: g.semi === true } : { name: OTHER_GROUP, configured: false, semi: false };
}

/** Картын эрэмбэ: тохиргооны дарааллаар, «Бусад» хамгийн сүүлд */
export function groupRank(name: string): number {
  const i = PRODUCTION_GROUPS.findIndex((g) => g.name === name);
  return i < 0 ? PRODUCTION_GROUPS.length : i;
}

export const isSemiGroup = (name: string): boolean => PRODUCTION_GROUPS.some((g) => g.name === name && g.semi === true);
