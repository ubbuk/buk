// «Үйлдвэрлэл» таб: бүтээгдэхүүний нэрийг үндсэн нэр, хувилбар болгон салгана. Цэвэр (сервер импортгүй): клиент, сервер хоёулаа ашиглана.
//   «Шон 80*80 Зас»  -> үндсэн «Шон 80*80», хувилбар repair (засварласан; үндсэн бүтээгдэхүүний тоонд нийлнэ, задаргаанд тусдаа)
//   «Шон 80*80 Брак» -> үндсэн «Шон 80*80», хувилбар defect (брак; тусдаа мөр, нийт гарцад ороход брак хувийг тооцно)
export type ProductVariant = "main" | "repair" | "defect";

const SUFFIX = /^(.*\S)\s+\(?(зас|брак)\)?\.?$/iu; // «… Брак», «… (брак)», «… Зас»

export function splitProductName(raw: string): { base: string; variant: ProductVariant } {
  const name = raw.replace(/\s+/g, " ").trim();
  const m = SUFFIX.exec(name);
  if (!m) return { base: name, variant: "main" };
  return { base: m[1].trim(), variant: m[2].toLowerCase() === "брак" ? "defect" : "repair" };
}

/**
 * Гарцын шат: finished = 1441 бэлэн бүтээгдэхүүн, semi = 1431 хагас боловсруулсан, crusher = 1401 (бутлан ангилах үйлдвэрийн гарц).
 * reclass = «Дараа нь брак болсон»: КомплектацияНоменклатуры (Дт 1441 ← Кт 1441)-аар бэлэн/засвартай бүтээгдэхүүнийг брак болгон шилжүүлсэн, шилжүүлсэн өдрөөр. Гарц биш (давхар тоолохгүй).
 */
export type ProductionStage = "finished" | "semi" | "crusher" | "reclass" | "defect_to_ready" | "repair_to_ready";

/**
 * Комплектацийн шилжүүлгийн шатууд (гарц биш, давхар тоолохгүй): reclass = дараа нь брак болсон; defect_to_ready = Бракаас бэлэн болгосон; repair_to_ready = Засвараас бэлэн болгосон
 * (толгой бүтээгдэхүүн «Зас»/«Брак»-гүй, эх бүтээгдэхүүн «… Брак»/«… Зас»; тоо нь эх бүтээгдэхүүний тоо).
 */
export const RECLASS_STAGES: readonly ProductionStage[] = ["reclass", "defect_to_ready", "repair_to_ready"];
export const isReclassStage = (stage: string): boolean => (RECLASS_STAGES as readonly string[]).includes(stage);

/** Гарцын дансны код (1441, 1431, 1401 ...) -> шат. Мэдэгдэхгүй данс бол null (тооцохгүй). */
export function stageOfAccount(code: string): ProductionStage | null {
  const base = code.replace(/\..*$/, "");
  if (base === "1441" || base === "1440") return "finished";
  if (base === "1431" || base === "1430") return "semi";
  if (base === "1401" || base === "1400") return "crusher";
  return null;
}

/** Хэлтсийн нэрийг харьцуулахад зориулж жигдрүүлнэ (BOSS-ийн цех 1С-ийн хэлтэстэй тохирох эсэх) */
export const normalizeDepartment = (name: string): string => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
