// 1С баримтын төрлүүд: нэр, өнгө, ангилал. Edge/клиент аюулгүй: сервер импортгүй, env уншихгүй.
// Хэрэглэгчид 1С-ийн техникийн нэр (Document_, Catalog_, GUID) ХЭЗЭЭ Ч харагдахгүй: зөвхөн доорх монгол нэр.

/** Орлого (ногоон) / зарлага (улаан) / шилжүүлэг (хөх) / бусад */
export type DocTone = "in" | "out" | "move" | "other";

export const DOC_KIND_KEYS = ["receipt", "requisition", "writeoff", "transfer", "sale", "bank_in", "bank_out", "cash_in", "cash_out"] as const;
export type DocKind = (typeof DOC_KIND_KEYS)[number];

export interface DocKindInfo {
  label: string;
  tone: DocTone;
  /** 1С-ийн баримтын нэр (Document_ угтваргүй) */
  entity: string;
  /** агуулахын баримт (няравт нээлттэй): барааны хөдөлгөөн */
  warehouse: boolean;
}

export const DOC_KINDS: Record<DocKind, DocKindInfo> = {
  receipt: { label: "Бараа хүлээн авсан", tone: "in", entity: "ПоступлениеТоваровУслуг", warehouse: true },
  requisition: { label: "Шаардах хуудас", tone: "out", entity: "ТребованиеНакладная", warehouse: true },
  writeoff: { label: "Бараа хассан", tone: "out", entity: "СписаниеТоваров", warehouse: true },
  transfer: { label: "Агуулах хоорондын шилжүүлэг", tone: "move", entity: "ПеремещениеТоваров", warehouse: true },
  sale: { label: "Борлуулалт", tone: "out", entity: "РеализацияТоваровУслуг", warehouse: true },
  bank_in: { label: "Банкны орлого", tone: "in", entity: "ПоступлениеНаРасчетныйСчет", warehouse: false },
  bank_out: { label: "Банкны зарлага", tone: "out", entity: "СписаниеСРасчетногоСчета", warehouse: false },
  cash_in: { label: "Кассын орлого", tone: "in", entity: "ПриходныйКассовыйОрдер", warehouse: false },
  cash_out: { label: "Кассын зарлага", tone: "out", entity: "РасходныйКассовыйОрдер", warehouse: false },
};

/** Агуулахын хөдөлгөөн (Агуулах табын «Хөдөлгөөн» хэсэг, нярав харна) */
export const MOVEMENT_KINDS: readonly DocKind[] = ["receipt", "requisition", "writeoff", "transfer", "sale"];

export const isDocKind = (v: string): v is DocKind => (DOC_KIND_KEYS as readonly string[]).includes(v);
export const kindByEntity = (entity: string): DocKind | null => DOC_KIND_KEYS.find((k) => DOC_KINDS[k].entity === entity) ?? null;

/** Тодорхойгүй төрлийн баримтын нэр (нягтлангийн бичилт гаргасан бусад баримт) */
const OTHER_LABELS: Record<string, string> = {
  ОперацияБух: "Гараар оруулсан бичилт",
  ВводНачальныхОстатков: "Эхний үлдэгдэл",
  ОтчетПроизводстваЗаСмену: "Үйлдвэрлэлийн тайлан",
  КомплектацияНоменклатуры: "Комплектлэл",
  ПоступлениеДопРасходов: "Нэмэлт зардлын орлого",
  ГТДИмпорт: "Гаалийн мэдүүлэг (импорт)",
  ПлатежноеПоручениеИсходящее: "Төлбөрийн даалгавар",
  АвансовыйОтчет: "Урьдчилгаа тайлан",
  ВозвратТоваровПоставщику: "Нийлүүлэгчид буцаасан",
  ВозвратТоваровОтПокупателя: "Худалдан авагчаас буцаасан",
  ОприходованиеТоваров: "Бараа оруулсан (орлогодсон)",
  ИнвентаризацияТоваровНаСкладе: "Тооллого",
  РегламентнаяОперация: "Тогтмол үйлдэл",
  ОперацияПоОтражениюЗПВБухгалтерии: "Бүртгэлийн үйлдэл",
};

/** Баримтын төрлийн монгол нэр. entity = 1С-ийн баримтын нэр (Document_ угтваргүй) */
export function entityLabel(entity: string): string {
  const k = kindByEntity(entity);
  return k ? DOC_KINDS[k].label : (OTHER_LABELS[entity] ?? "Бусад баримт");
}

export function entityTone(entity: string): DocTone {
  const k = kindByEntity(entity);
  return k ? DOC_KINDS[k].tone : "other";
}

/** 1С-ийн Recorder_Type ("StandardODATA.Document_X") -> "X" */
export const entityOfRecorderType = (t: unknown): string => String(t ?? "").replace(/^.*Document_/, "");

/** Баримтын дэлгэрэнгүйг нээх лавлагаа: (төрөл, GUID). type нь 1С-ийн баримтын нэр, ref нь GUID */
export interface DocRef {
  type: string;
  ref: string;
}

export interface DocCard {
  kind: DocKind | "other";
  type: string;
  ref: string;
  number: string;
  /** "2026-11-11T11:03:15" */
  date: string;
  label: string;
  tone: DocTone;
  /** харилцагч, эсвэл шаардах хуудасны хувьд хэлтэс */
  party: string;
  partyCode: string;
  warehouse: string;
  warehouseCode: string;
  /** шилжүүлгийн хүлээн авагч агуулах */
  warehouseTo: string;
  warehouseToCode: string;
  amount: number;
  /** мөрийн тоо (бараа/үйлчилгээ); тодорхойгүй бол null */
  lines: number | null;
  comment: string;
}

export interface DocLine {
  n: number;
  itemKey: string;
  item: string;
  itemCode: string;
  unit: string;
  qty: number;
  price: number;
  amount: number;
  vat: number;
}

export interface DocPosting {
  n: number;
  debit: { name: string; code: string };
  credit: { name: string; code: string };
  amount: number;
  qty: number | null;
  memo: string;
}

export interface DocDetail {
  type: string;
  ref: string;
  kind: DocKind | "other";
  label: string;
  tone: DocTone;
  number: string;
  date: string;
  posted: boolean;
  fields: { label: string; value: string }[];
  comment: string;
  lines: DocLine[];
  /** мөрийн хүснэгтийн гарчиг: «Бараа», «Үйлчилгээ» */
  totals: { amount: number; vat: number; total: number; vatIncluded: boolean | null; qty: number };
  /** нягтлангийн бичилт (нярав харахгүй) */
  postings: DocPosting[];
  /** мөрийн дүнг 1С-ийн нягтлан бодох бүртгэлээс авсан (баримт өөрөө өртөг хадгалдаггүй) */
  costFromLedger: boolean;
}

export interface ItemHistoryRow {
  date: string;
  type: string;
  ref: string;
  label: string;
  tone: DocTone;
  number: string;
  warehouse: string;
  direction: "in" | "out";
  qty: number;
  amount: number;
}

export interface ItemHistory {
  itemKey: string;
  item: string;
  itemCode: string;
  unit: string;
  from: string;
  to: string;
  rows: ItemHistoryRow[];
  totals: { inQty: number; inAmount: number; outQty: number; outAmount: number };
}
