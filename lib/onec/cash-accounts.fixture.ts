// Туршилтын өгөгдөл: «Данснууд» (lib/onec/cash-accounts*.test.ts, app/api/dashboard/cash/accounts.test.ts). ₮ данс, валютын (USD) данс, касс, нуух данс; орлого, зарлага, шилжүүлэг.
import type { CashInputs } from "./cash"; // зөвхөн төрөл: тестийн vi.mock("./cash")-тэй цикл үүсгэхгүй

export const MONTH = "2026-09";
export const A1 = "a1a1a1a1-0000-0000-0000-000000000001"; // 1101 ₮ банкны данс
const A2 = "a2a2a2a2-0000-0000-0000-000000000002"; // 1102 валютын данс
const A3 = "a3a3a3a3-0000-0000-0000-000000000003"; // 1001 касс
const OTHER = "a9a9a9a9-0000-0000-0000-000000000009"; // 3101 өглөг
const REC = "a8a8a8a8-0000-0000-0000-000000000008"; // 1501 авлага
const B1 = "b1b1b1b1-0000-0000-0000-000000000001";
const B2 = "b2b2b2b2-0000-0000-0000-000000000002";
const B3 = "b3b3b3b3-0000-0000-0000-000000000003";
const P1 = "c1c1c1c1-0000-0000-0000-00000000000a";
const P2 = "c2c2c2c2-0000-0000-0000-00000000000b";
const T = "StandardODATA.Catalog_";
const EMPTY = "00000000-0000-0000-0000-000000000000";

const entry = (id: string, date: string, dr: string[], cr: string[], amount: number, extra: Record<string, unknown> = {}) => {
  const side = (p: "Dr" | "Cr", [acct, ...dims]: string[]) => ({
    [`Account${p}_Key`]: acct,
    [`ExtDimension${p}1`]: dims[0] ?? EMPTY,
    [`ExtDimension${p}1_Type`]: dims[0] ? (dims[0] === P1 || dims[0] === P2 ? `${T}Контрагенты` : `${T}БанковскиеСчета`) : "StandardODATA.Undefined",
    [`ExtDimension${p}2`]: EMPTY,
    [`ExtDimension${p}2_Type`]: "StandardODATA.Undefined",
  });
  return { Recorder: id, LineNumber: "1", Period: `${date}T12:00:00`, Recorder_Type: "StandardODATA.Document_ПоступлениеНаРасчетныйСчет", Сумма: amount, Содержание: "тест", ...side("Dr", dr), ...side("Cr", cr), ...extra };
};
const bal = (acct: string, bank: string | null, amount: number, fx = 0) => ({ Account_Key: acct, ExtDimension1: bank ?? EMPTY, ExtDimension1_Type: bank ? `${T}БанковскиеСчета` : "StandardODATA.Undefined", ExtDimension2: EMPTY, ExtDimension2_Type: "StandardODATA.Undefined", ExtDimension3: EMPTY, ExtDimension3_Type: "StandardODATA.Undefined", СуммаBalance: amount, ВалютнаяСуммаBalance: fx });

export const fixtureInputs = (): CashInputs => ({
  month: MONTH,
  asOf: "2026-09-30",
  accounts: new Map([
    [A1, { code: "1101.00", name: "Банкин дах мөнгө - MNT" }],
    [A2, { code: "1102.00", name: "Банкин дах мөнгө - валют" }],
    [A3, { code: "1001.00", name: "Касс дахь бэлэн мөнгө - MNT" }],
  ]),
  records: [
    entry("d1", "2026-09-05", [A1, B1], [REC, P1], 1000), // орлого
    entry("d2", "2026-09-07", [OTHER, P2], [A1, B1], 300), // зарлага
    entry("d3", "2026-09-07", [A2, B2], [A1, B1], 200, { ВалютнаяСуммаDr: 50, ВалютнаяСуммаCr: 0 }), // шилжүүлэг ₮ данс -> валютын данс
    entry("d4", "2026-09-20", [A2, B2], [REC, P1], 400, { ВалютнаяСуммаDr: 100, ВалютнаяСуммаCr: 0 }), // валютын дансны орлого
    entry("d5", "2026-09-25", [A3], [A2, B2], 100, { ВалютнаяСуммаDr: 0, ВалютнаяСуммаCr: 25 }), // валютын данснаас кассд шилжүүлэг
  ],
  opening: [bal(A1, B1, 500), bal(A2, B2, 100, 25), bal(A3, null, 50), bal(A1, B3, 7)],
  closing: [bal(A1, B1, 1000), bal(A2, B2, 700 - 100, 150), bal(A3, null, 150), bal(A1, B3, 7)],
  names: {
    banks: new Map([[B1, "5003636128, ХААН банк, MNT"], [B2, "5003636139, ХААН банк, USD"], [B3, "3096022132, Капитрон банк, MNT"]]),
    flows: new Map(),
    parties: new Map([[P1, "Альфа ХХК"], [P2, "Бета ХХК"]]),
    chart: new Map([[A1, { code: "1101.00", name: "Банкин дах мөнгө - MNT" }], [A2, { code: "1102.00", name: "Банкин дах мөнгө - валют" }], [A3, { code: "1001.00", name: "Касс дахь бэлэн мөнгө - MNT" }], [OTHER, { code: "3101.00", name: "Өглөг" }], [REC, { code: "1501.00", name: "Авлага" }]]),
  },
});

export const K = { main: `bank:${B1}`, usd: `bank:${B2}`, hidden: `bank:${B3}`, cash: "acct:1001" };
