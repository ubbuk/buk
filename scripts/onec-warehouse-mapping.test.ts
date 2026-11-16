import { describe, expect, it } from "vitest";
import { classify, normalizeName } from "./onec-warehouse-mapping";

const wh = (id: string, name: string, level: "дээд" | "байршил" = "байршил") => ({ id, name, level, onecCode: null, key: normalizeName(name) });
const onec = (code: string, name: string) => ({ code, name, rows: 1, lastSnapshot: "2026-11-01" });

describe("1С warehouse mapping report", () => {
  it("normalises case, punctuation, spaces and ё", () => {
    expect(normalizeName("Ууганцэцэг (хангамж)")).toBe("ууганцэцэгхангамж");
    expect(normalizeName("Механик цех 1, 2")).toBe(normalizeName("механик ЦЕХ 1 2"));
    expect(normalizeName("Берёза")).toBe(normalizeName("Береза"));
  });

  it("only an exact normalised name is a match; a partial name is a candidate, never auto-matched", () => {
    const r = classify([onec("1", "Силос"), onec("2", "Ууганцэцэг"), onec("3", "Агуулах Х")], [wh("a", "силос"), wh("b", "Ууганцэцэг (хангамж)", "дээд"), wh("c", "Боогий", "дээд")]);
    expect(r.exact.map((m) => [m.onec.code, m.wh.id])).toEqual([["1", "a"]]);
    expect(r.partial.map((m) => [m.onec.code, m.wh.id])).toEqual([["2", "b"]]);
    expect(r.unmatched.map((o) => o.code)).toEqual(["3"]);
    expect(r.missingInOnec.map((w) => w.id)).toEqual(["c"]);
  });

  it("reports duplicates without picking one", () => {
    const r = classify([onec("1", "Төв"), onec("2", "Төв"), onec("3", "Бутлуур"), onec("3", "Бутлуур 2")], [wh("a", "Төв"), wh("b", "Бутлуур")]);
    expect(r.duplicates.sameNameManyCodes).toEqual([{ name: "төв", codes: ["1", "2"] }]);
    expect(r.duplicates.sameCodeManyNames).toEqual([{ code: "3", names: ["Бутлуур", "Бутлуур 2"] }]);
    expect(r.duplicates.manyOnecOneWarehouse.map((d) => d.wh.id).sort()).toEqual(["a", "b"]);
  });
});
