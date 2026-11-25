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
  /** хуудасны URL-д кирилл биш латин нэр: /finance/production/tbhets */
  slug: string;
  /** бетон хийцийн цех: гарцыг Бэлэн | Засвар | Брак гэж ангилж харуулна */
  concrete?: boolean;
}

/** Картуудын дараалал энэ жагсаалтаар */
export const PRODUCTION_GROUPS: readonly ProductionGroupConfig[] = [
  { name: "Бетон дэрний хэсэг", slug: "der", concrete: true, departments: ["Төмөр замын төмөр бетон дэрний хэсэг"] },
  { name: "Төмөр бетон хийц эдлэлийн цех", slug: "tbhets", concrete: true, departments: ["Төмөр бетон хийц эдлэлийн цех"] },
  { name: "Тенсиланд хэсэг", slug: "tensiland", concrete: true, departments: ["Тенсиланд хэсэг"] },
  { name: "Вольтамиксийн хэсэг", slug: "voltamix", concrete: true, departments: ["Вольтамиксийн хэсэг"] },
  { name: "Бетон зуурмаг (БАЗ-3, БАЗ-4)", slug: "baz", departments: ["БАЗ-3", "БАЗ-4"], semi: true },
  { name: "Арматурын хэсэг", slug: "armatur", departments: ["Арматурын хэсэг"], semi: true },
  { name: "Бутлан ангилах үйлдвэр", slug: "butluur", departments: ["Бутлан ангилах үйлдвэр"] },
  { name: "Металл хийц", slug: "metal", departments: ["Металл хийц үйлдвэрлэлийн цех"] },
];

/** Тохиргоонд байхгүй хэлтсүүд */
export const OTHER_GROUP = "Бусад";
export const OTHER_SLUG = "busad";

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

export const isConcreteGroup = (name: string): boolean => PRODUCTION_GROUPS.some((g) => g.name === name && g.concrete === true);

/** Картын нэр -> URL-ийн латин slug (tbhets, der, ... busad) */
export const slugOf = (name: string): string => (name === OTHER_GROUP ? OTHER_SLUG : (PRODUCTION_GROUPS.find((g) => g.name === name)?.slug ?? encodeURIComponent(name)));

/** Бүх цехийн хуудас (8 цех + «Бусад») */
export const WORKSHOP_PAGES: readonly { name: string; slug: string }[] = [...PRODUCTION_GROUPS.map((g) => ({ name: g.name, slug: g.slug })), { name: OTHER_GROUP, slug: OTHER_SLUG }];

/**
 * URL-ийн параметр -> цех. Латин slug (tbhets) эсвэл хуучин кирилл нэр (хаалт, таслалт, %20, "+", NFC/NFD, том жижиг үсгийн ялгаагүй; цехийн нэр эсвэл 1С-ийн хэлтсийн нэр).
 * `canonical` = параметр нь slug өөрөө (үгүй бол хуучин URL: slug руу redirect хийнэ). Олдохгүй бол null.
 */
export function resolveWorkshopParam(raw: string): { name: string; slug: string; canonical: boolean } | null {
  let v = raw;
  for (let i = 0; i < 2 && /%[0-9a-f]{2}/i.test(v); i++) {
    try {
      v = decodeURIComponent(v);
    } catch {
      break;
    }
  }
  v = v.replace(/\+/g, " ").normalize("NFC").trim();
  const slug = v.toLowerCase();
  const bySlug = WORKSHOP_PAGES.find((p) => p.slug === slug);
  if (bySlug) return { ...bySlug, canonical: true };
  const key = normalizeDepartment(v);
  if (!key) return null;
  for (const g of PRODUCTION_GROUPS) {
    if (normalizeDepartment(g.name) === key || g.departments.some((d) => normalizeDepartment(d) === key)) return { name: g.name, slug: g.slug, canonical: false };
  }
  if (normalizeDepartment(OTHER_GROUP) === key) return { name: OTHER_GROUP, slug: OTHER_SLUG, canonical: false };
  return null;
}

