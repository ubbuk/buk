import { describe, expect, it } from "vitest";
import { sumMonth } from "./cash-trend";

const CASH_A = "aaaaaaaa-0000-0000-0000-000000000001";
const CASH_B = "aaaaaaaa-0000-0000-0000-000000000002";
const OTHER = "bbbbbbbb-0000-0000-0000-000000000001";
const keys = new Set([CASH_A, CASH_B]);
const rec = (dr: string, cr: string, amount: number) => ({ AccountDr_Key: dr, AccountCr_Key: cr, Сумма: amount });

describe("sumMonth: сарын орлого, зарлага, шилжүүлэг", () => {
  it("Дт мөнгөний данс = орлого, Кт = зарлага, хоёулаа мөнгөний данс = дотоод шилжүүлэг (орлого зарлагад тооцогдохгүй)", () => {
    const m = sumMonth("2026-11", [rec(CASH_A, OTHER, 1000.5), rec(OTHER, CASH_A, 300), rec(CASH_B, CASH_A, 1_000_000), rec(OTHER, OTHER, 99)], keys);
    expect(m).toEqual({ month: "2026-11", inflow: 1000.5, outflow: 300, internal: 1_000_000 });
  });

  it("түлхүүрийн том жижиг үсгийг ялгахгүй, хоосон сар 0", () => {
    expect(sumMonth("2026-01", [rec(CASH_A.toUpperCase(), OTHER, 5)], keys).inflow).toBe(5);
    expect(sumMonth("2026-02", [], keys)).toEqual({ month: "2026-02", inflow: 0, outflow: 0, internal: 0 });
  });
});
