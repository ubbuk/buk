// «Цалин» табын удирдлагад зориулсан харагдац (цэвэр функц, Postgres-ийн onec_payroll_month-оос): цалингийн нийт зардал, задаргаа,
// «хаашаа очсон», өмнөх сартай харьцуулалт, 12 сар. Нягтлангийн нэр томьёо, дансны код энд байхгүй (зөвхөн хамгийн доод drill-down-д).
import { changePct } from "./expense-groups";
import type { PayrollMonthRow } from "./payroll-store";

export type PayrollPartId = "main" | "benefit" | "sick" | "board" | "employerNdsh";

export const PAYROLL_PART_LABEL: Record<PayrollPartId, string> = {
  main: "Үндсэн цалин",
  benefit: "Тэтгэмж",
  sick: "Өвчний тэтгэмж (ажил олгогчийн)",
  board: "ТУЗ-ийн урамшуулал",
  employerNdsh: "Ажил олгогчийн НДШ",
};
export const PAYROLL_PART_ORDER: PayrollPartId[] = ["main", "benefit", "sick", "board", "employerNdsh"];

/** Задаргааны мөр бүр нягтланд аль дансны Кт талд бичигддэг (хамгийн доод drill-down: баримтуудыг харах) */
export const PAYROLL_PART_ACCOUNT: Record<PayrollPartId, string> = { main: "3342", benefit: "3342", sick: "3342", board: "3349", employerNdsh: "3450" };

export interface PayrollPartView {
  id: PayrollPartId;
  label: string;
  amount: number;
  prevAmount: number;
  changePct: number | null;
  /** нийт зардалд эзлэх хувь (0..100) */
  share: number;
  /** 12 сарын дүн (`months`-тэй ижил дараалал) */
  series: number[];
}
export interface PayrollWent {
  /** гарт олгосон: банк, касс (ТУЗ-ийн урамшууллыг оруулаад) */
  paid: number;
  paidBank: number;
  paidCash: number;
  /** ХХОАТ, ажилтнаас суутгасан НДШ (ТУЗ-ийнхыг оруулаад), бусад суутгал */
  hhoat: number;
  employeeNdsh: number;
  other: number;
}
export interface PayrollView {
  month: string;
  prevMonth: string;
  /** сар sync-ээр татагдсан бөгөөд задаргаатай эсэх: false бол нийт дүнг гаргахгүй */
  ready: boolean;
  /** татагдсан боловч задаргаа хараахан ороогүй (хуучин мөр): дараагийн sync-ээр бөглөгдөнө */
  pending: boolean;
  /** бодолт нягтланд бүртгэгдсэн эсэх: false бол «Бодолт хараахан бүртгэгдээгүй» */
  posted: boolean;
  /** цалингийн нийт зардал = ажилтны бодсон + ТУЗ-ийн урамшуулал + ажил олгогчийн НДШ (= задаргааны нийлбэр) */
  total: number;
  /** ажилтанд бодсон (нийт зардлаас ажил олгогчийн НДШ, ТУЗ-ийн урамшуулалгүй) */
  employeesGross: number;
  prevTotal: number;
  /** өмнөх сар татагдсан эсэх: false бол «татагдаагүй» (0 гэж харуулахгүй) */
  prevLoaded: boolean;
  changePct: number | null;
  parts: PayrollPartView[];
  /** бодолтгүй сард null */
  went: PayrollWent | null;
  months: { month: string; loaded: boolean; total: number }[];
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Нэг сарын задаргааны дүнгүүд. Үндсэн цалин = бодсон − тэтгэмж − өвчний тэтгэмж, тиймээс нийлбэр нь бодсонтой үргэлж тэнцүү. */
export function partAmounts(r: PayrollMonthRow): Record<PayrollPartId, number> {
  return {
    main: round2(r.accrued - r.benefit - r.sickPay),
    benefit: r.benefit,
    sick: r.sickPay,
    board: r.board,
    employerNdsh: r.employerNdsh,
  };
}

const sumParts = (p: Record<PayrollPartId, number>) => round2(PAYROLL_PART_ORDER.reduce((s, id) => s + p[id], 0));

/** `rows`: onec_payroll_month-ийн мөрүүд; `months`: 12 сар (хуучнаас шинэ рүү, сүүлийнх нь сонгосон сар) */
export function buildPayrollView(rows: readonly PayrollMonthRow[], months: readonly string[]): PayrollView {
  const last = months.length - 1;
  const month = months[last];
  const prevMonth = months[last - 1] ?? "";
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  const amounts = months.map((m) => {
    const r = byMonth.get(m);
    return r?.breakdown ? partAmounts(r) : null;
  });
  const totals = amounts.map((a) => (a ? sumParts(a) : 0));
  const cur = byMonth.get(month);
  const curAmounts = amounts[last];
  const prevAmounts = amounts[last - 1] ?? null;
  const total = totals[last];
  const prevTotal = totals[last - 1] ?? 0;

  const posted = !!cur && (cur.employerNdsh > 0 || cur.employeeNdsh > 0 || cur.hhoat > 0 || cur.board > 0);
  // Бодолт хараахан бүртгэгдээгүй сард өмнөх сартай харьцуулахгүй (−100% гэх мэт төөрөгдүүлэх хувь гаргахгүй)
  const comparable = posted ? prevAmounts : null;

  const parts: PayrollPartView[] = PAYROLL_PART_ORDER.map((id) => {
    const amount = curAmounts?.[id] ?? 0;
    const prevAmount = prevAmounts?.[id] ?? 0;
    return { id, label: PAYROLL_PART_LABEL[id], amount, prevAmount, changePct: comparable ? changePct(amount, prevAmount) : null, share: total ? (amount / total) * 100 : 0, series: amounts.map((a) => a?.[id] ?? 0) };
  });

  const went: PayrollWent | null =
    cur?.breakdown && posted
      ? {
          paid: round2(cur.paidBank + cur.paidCash + cur.boardPaid),
          paidBank: cur.paidBank,
          paidCash: cur.paidCash,
          hhoat: round2(cur.hhoat + cur.boardHhoat),
          employeeNdsh: round2(cur.employeeNdsh + cur.boardNdsh),
          other: cur.otherDeductions,
        }
      : null;

  return {
    month,
    prevMonth,
    ready: !!curAmounts,
    pending: !!cur && !cur.breakdown,
    posted,
    total,
    employeesGross: curAmounts ? round2(curAmounts.main + curAmounts.benefit + curAmounts.sick) : 0,
    prevTotal,
    prevLoaded: !!prevAmounts,
    changePct: comparable ? changePct(total, prevTotal) : null,
    parts,
    went,
    months: months.map((m, i) => ({ month: m, loaded: !!amounts[i], total: totals[i] })),
  };
}
