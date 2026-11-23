// «Зарцуулалт» табын удирдлагад зориулсан харагдац (цэвэр функц): цех, хэлтэс → материал, материал → цех, хэлтэс. Түвшин бүрт тоо хэмжээ
// нэгжтэйгээ (нэгжийг хооронд нь нэмэхгүй: «48.5 тонн · 3,200 ширхэг») ба ₮. Олголтын баримтын дугаар, 1С-ийн техникийн нэр энд байхгүй.
import { sumQuantities, type Quantity } from "@/lib/units";
import type { UsageDepartment, UsageDeptMaterial, UsageMaterial } from "./usage";

export interface UsageDeptView {
  name: string;
  amount: number;
  /** олголтын баримтын тоо (1С-д «шаардах хуудас») */
  documents: number;
  quantities: Quantity[];
  materials: { key: string; name: string; unit: string; quantity: number; amount: number }[];
}
export interface UsageMaterialView {
  key: string;
  name: string;
  unit: string;
  quantity: number;
  amount: number;
  documents: number;
  departments: { name: string; quantity: number; amount: number }[];
}
export interface UsageView {
  departments: UsageDeptView[];
  materials: UsageMaterialView[];
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const byAmount = <T extends { amount: number; name: string }>(a: T, b: T) => b.amount - a.amount || a.name.localeCompare(b.name, "mn");

export function buildUsageView(byDepartment: readonly UsageDepartment[], byMaterial: readonly UsageMaterial[], deptMaterials: readonly UsageDeptMaterial[]): UsageView {
  const deptList = new Map<string, UsageDeptView>(byDepartment.map((d) => [d.name, { name: d.name, amount: d.amount, documents: d.documents, quantities: [], materials: [] }]));
  const matList = new Map<string, UsageMaterialView>(byMaterial.map((m) => [m.key, { key: m.key, name: m.name, unit: m.unit, quantity: m.quantity, amount: m.amount, documents: m.documents, departments: [] }]));

  for (const dm of deptMaterials) {
    const d = deptList.get(dm.department) ?? { name: dm.department, amount: 0, documents: 0, quantities: [], materials: [] };
    d.materials.push({ key: dm.key, name: dm.name, unit: dm.unit, quantity: dm.quantity, amount: dm.amount });
    deptList.set(dm.department, d);
    const m = matList.get(dm.key);
    if (m) m.departments.push({ name: dm.department, quantity: dm.quantity, amount: dm.amount });
  }

  const departments = [...deptList.values()].map((d) => ({ ...d, amount: round2(d.amount), materials: d.materials.sort(byAmount), quantities: sumQuantities(d.materials.map((x) => ({ qty: x.quantity, unit: x.unit }))) }));
  const materials = [...matList.values()].map((m) => ({ ...m, departments: m.departments.sort(byAmount) }));
  return { departments: departments.sort(byAmount), materials: materials.sort(byAmount) };
}
