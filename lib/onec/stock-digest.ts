import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";

// onec_stock-ийн нэг өдрийн snapshot-ийн хуруун хээ. Sync 15 минут тутамд ажилладаг ч 1С-ийн үлдэгдэл ихэнхдээ өөрчлөгддөггүй: хуурамч
// «өөрчлөлт» бүрт ~2,000 мөрийг устгаад дахин бичих нь Neon-ы CU-цаг, WAL, индексийн хөдөлгөөнийг дэмий үрдэг. Тиймээс шинээр татсан мөрүүд DB-д
// байгаатай яг ижил бол sync тэднийг бичихгүй (lib/onec/sync.ts).

export interface StockDigestRow {
  org: string;
  warehouseCode: string;
  warehouse: string;
  itemCode: string;
  item: string;
  unit: string;
  account: string;
  qty: number | Prisma.Decimal;
  amount: number | Prisma.Decimal;
}

// DB талд Decimal(18,4) / Decimal(18,2) тул хоёр талыг ТЭР ЯГ нарийвчлалаар хөрвүүлж харьцуулна («12.5» ба «12.5000» нэг тоо). Decimal ашигласнаар
// 1e15-аас том дүн ч float-ийн алдаагүй.
const fixed = (v: number | Prisma.Decimal, places: number) => new Prisma.Decimal(v).toFixed(places);

/** Мөрийн дараалалд үл хамаарах sha256: талбар бүр, мөрийн тоо хоёулаа орно */
export function stockDigest(rows: Iterable<StockDigestRow>): string {
  const lines = [...rows]
    .map((r) => [r.org, r.warehouseCode, r.warehouse, r.itemCode, r.item, r.unit, r.account, fixed(r.qty, 4), fixed(r.amount, 2)].join("\u001f"))
    .sort();
  return createHash("sha256").update(`${lines.length}\n${lines.join("\n")}`).digest("hex");
}
