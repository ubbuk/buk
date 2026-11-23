import { describe, expect, it } from "vitest";
import { buildAccountBook } from "./accounts";
import { buildPayrollMonth, isBenefitText, payrollContext } from "./payroll";

// 2026-09-ийн жинхэнэ 1С-тэй тулгасан дүнгүүд: нягтлангийн «9 сарын цалин» УБ00-000179, тэтгэмж УБ00-000165, өвчний хуудас 043–045, ТУЗ УБ00-000182.
const G = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ACC = { cash: G(1), bank: G(2), sal: G(3), ndsh: G(4), hhoat: G(5), adv: G(6), sick: G(7), wip: G(8), exp: G(9), ap: G(11), board: G(12) };
const book = buildAccountBook([
  { Ref_Key: ACC.cash, Code: "1001.00", Description: "Касс" },
  { Ref_Key: ACC.bank, Code: "1101.00", Description: "Банк" },
  { Ref_Key: ACC.sal, Code: "3342.00", Description: "Цалингийн өглөг" },
  { Ref_Key: ACC.board, Code: "3349.00", Description: "Бусад өглөг" },
  { Ref_Key: ACC.ndsh, Code: "3450.00", Description: "НДШ" },
  { Ref_Key: ACC.hhoat, Code: "3462.00", Description: "ХХОАТ" },
  { Ref_Key: ACC.adv, Code: "1249.00", Description: "Суутгалын авлага" },
  { Ref_Key: ACC.sick, Code: "1295.00", Description: "Тэтгэмжийн авлага" },
  { Ref_Key: ACC.wip, Code: "1424.00", Description: "Дуусаагүй үйлдвэрлэл" },
  { Ref_Key: ACC.exp, Code: "7000.00", Description: "Үйл ажиллагааны зардал" },
  { Ref_Key: ACC.ap, Code: "3101.00", Description: "Өглөг" },
]);
const ctx = payrollContext(book);
const R179 = G(179);
const R165 = G(165);
const R182 = G(182);
const SICK = "StandardODATA.Document_БольничныйЛист";
const JOURNAL = "StandardODATA.Document_ОперацияБух";
const rec = (dr: string, cr: string, amount: number, recorder: string, type = JOURNAL) => ({ AccountDr_Key: dr, AccountCr_Key: cr, Сумма: amount, Recorder: recorder, Recorder_Type: type });
const round = (v: number) => Math.round(v * 100) / 100;

const lines = [
  rec(ACC.wip, ACC.sal, 679_416_440.43, R179),
  rec(ACC.exp, ACC.sal, 462_076_069.28, R179),
  rec(ACC.exp, ACC.sal, 28_179_590.91, R179),
  rec(ACC.exp, ACC.sal, 13_440_000, R165), // тэтгэмж
  rec(ACC.exp, ACC.sal, 1_496_916, G(43), SICK), // өвчний хуудас
  rec(ACC.exp, ACC.board, 18_000_000, R182), // ТУЗ
  rec(ACC.exp, ACC.ndsh, 1_775_000, R182), // ТУЗ-ийн ажил олгогчийн НДШ
  rec(ACC.exp, ACC.ndsh, 100_000_000, R179),
  rec(ACC.board, ACC.ndsh, 1_641_500, R182),
  rec(ACC.board, ACC.hhoat, 1_479_850, R182),
  rec(ACC.board, ACC.bank, 5_643_600, G(1)),
  rec(ACC.board, ACC.sal, 8_021_600, G(168)), // ТУЗ-ийн өглөгийг шилжүүлсэн: олгосон ч, суутгал ч биш
  rec(ACC.sal, ACC.bank, 1_125_467_606.06, G(2)),
  rec(ACC.sal, ACC.cash, 702_000, G(3)),
  rec(ACC.sal, ACC.ndsh, 121_222_176.33, G(4)),
  rec(ACC.sal, ACC.hhoat, 104_298_558.71, G(5)),
  rec(ACC.sal, ACC.sal, 28_611_528, G(6)), // ажилтнуудын хооронд шилжүүлэг: суутгал биш
  rec(ACC.sal, ACC.adv, 9_477_950, G(7)),
  rec(ACC.sal, ACC.ap, 691_815, G(8)),
];
const m = buildPayrollMonth("2026-09", lines, ctx, 0, new Set([R165]));

describe("buildPayrollMonth: задаргаа (2026-09-ийн тулгалт)", () => {
  it("бодсон 1,184,609,016.62 = «9 сарын цалин» 1,169,672,100.62 + тэтгэмж 13,440,000 + өвчний тэтгэмж 1,496,916", () => {
    expect(m.accrued).toBe(1_184_609_016.62);
    expect(m.benefit).toBe(13_440_000);
    expect(m.sickPay).toBe(1_496_916);
    expect(round(m.accrued - m.benefit - m.sickPay)).toBe(1_169_672_100.62);
  });

  it("ТУЗ-ийн 18,000,000 «бодсон»-д ороогүй, тусдаа; НДШ 1,641,500, ХХОАТ 1,479,850, олгосон 5,643,600 нь ТУЗ-ийнх", () => {
    expect(m.board).toBe(18_000_000);
    expect(m).toMatchObject({ boardNdsh: 1_641_500, boardHhoat: 1_479_850, boardPaid: 5_643_600 });
  });

  it("ажил олгогчийн НДШ-д ТУЗ-ийн 1,775,000 орно; шилжүүлэг (цалин→цалин, ТУЗ→цалин) суутгалд орохгүй", () => {
    expect(m.employerNdsh).toBe(101_775_000);
    expect(m).toMatchObject({ employeeNdsh: 121_222_176.33, hhoat: 104_298_558.71, paidBank: 1_125_467_606.06, paidCash: 702_000 });
    expect(m.otherDeductions).toBe(9_477_950 + 691_815);
  });

  it("баримтын гарчиг мэдэгдээгүй бол тэтгэмж үндсэн цалинд ордог ч нийт «бодсон» өөрчлөгдөхгүй", () => {
    const plain = buildPayrollMonth("2026-09", lines, ctx, 0);
    expect(plain.accrued).toBe(m.accrued);
    expect(plain.benefit).toBe(0);
  });
});

describe("isBenefitText: нягтлангийн баримтын гарчгаас тэтгэмж таних", () => {
  it("«тэтгэмж» агуулсан гарчиг; цалин, ТУЗ, хоосон биш", () => {
    expect(isBenefitText("2026 оны 9 сарын тэтгэмжийн мөнгө")).toBe(true);
    expect(isBenefitText("2026 оны 9 сарын цалин")).toBe(false);
    expect(isBenefitText("ТУЗ 2026 оны 9 сар")).toBe(false);
    expect(isBenefitText(undefined)).toBe(false);
  });
});
