import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { matchDepartmentPairs, matchDepartments, resolveProductionScope, SCOPE_NOTE_NO_MATCH } from "./production-scope";
import { buildProductionView, type ProductionLineRow } from "./production-view";

const ONEC = ["Тенсиланд хэсэг", "Төмөр бетон хийц эдлэлийн цех", "Арматурын хэсэг", "Бутлан ангилах үйлдвэр"];
const PAIRS = ONEC.map((d) => ({ department: d, group: d }));
// 1С-ийн бодит бүтэц: ТБХЭЦ-ийн дэд хэлтсүүд
const TBHC = "Төмөр бетон хийц эдлэлийн цех";
const TREE = [
  { department: "Тенсиланд хэсэг", group: TBHC },
  { department: "БАЗ-3", group: TBHC },
  { department: "Вольтамиксийн хэсэг", group: TBHC },
  { department: TBHC, group: TBHC },
  { department: "Арматурын хэсэг", group: "Арматурын хэсэг" },
];

describe("matchDepartments (ERP хэлтэс <-> 1С цех)", () => {
  it("нэр ижил (том/жижиг үсэг, цэг тэмдэг үл тооно)", () => {
    expect(matchDepartments(["ТЕНСИЛАНД ХЭСЭГ."], ONEC)).toEqual(["тенсиланд хэсэг"]);
  });
  it("нэг нь нөгөөгөө агуулсан бол тохирно", () => {
    expect(matchDepartments(["Төмөр бетон хийц эдлэлийн цех (ТБХЦ)"], ONEC)).toEqual(["төмөр бетон хийц эдлэлийн цех"]);
  });
  it("тохирохгүй, хэт богино нэр, хоосон жагсаалт: юу ч тохирохгүй", () => {
    expect(matchDepartments(["Санхүүгийн алба"], ONEC)).toEqual([]);
    expect(matchDepartments(["ТБ"], ONEC)).toEqual([]);
    expect(matchDepartments([], ONEC)).toEqual([]);
  });
});

describe("matchDepartmentPairs (дэд хэлтэс эх хэлтсээрээ)", () => {
  it("ТБХЭЦ-ийн BOSS дэд хэлтсүүдийг (Тенсиланд, БАЗ-3, Вольтамикс) бүгдийг, бусад цехийг үгүй", () => {
    expect(matchDepartmentPairs([TBHC], TREE).sort()).toEqual(["баз 3", "вольтамиксийн хэсэг", "тенсиланд хэсэг", "төмөр бетон хийц эдлэлийн цех"].sort());
  });
  it("дэд хэлтсийн BOSS зөвхөн өөрийн дэд хэлтсийг (бусад дэд хэлтэс, эх хэлтэс үгүй)", () => {
    expect(matchDepartmentPairs(["Тенсиланд хэсэг"], TREE)).toEqual(["тенсиланд хэсэг"]);
  });
  it("тохирохгүй бол хоосон", () => {
    expect(matchDepartmentPairs(["Санхүүгийн алба"], TREE)).toEqual([]);
  });
});

describe("resolveProductionScope (Postgres)", () => {
  const ids: { depts: string[]; users: string[] } = { depts: [], users: [] };
  const mkUser = async (suffix: string, role: "BOSS" | "ADMIN" | "DIRECTOR", departmentId: string | null) => {
    const u = await prisma.user.create({ data: { email: `prod-scope-${suffix}-${Date.now()}@test.local`, name: `Scope ${suffix}`, passwordHash: "x", role, departmentId } });
    ids.users.push(u.id);
    return u;
  };
  const mkDept = async (name: string, headId?: string) => {
    const d = await prisma.department.create({ data: { name, type: "FACTORY", headId: headId ?? null } });
    ids.depts.push(d.id);
    return d;
  };
  const clean = async () => {
    await prisma.department.updateMany({ where: { id: { in: ids.depts } }, data: { headId: null } });
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
    await prisma.department.deleteMany({ where: { id: { in: ids.depts } } });
    ids.depts = [];
    ids.users = [];
  };
  beforeEach(clean);
  afterEach(clean);

  it("ADMIN, DIRECTOR (болон бусад) бүх цех: departments = null", async () => {
    const admin = await mkUser("a", "ADMIN", null);
    const director = await mkUser("d", "DIRECTOR", null);
    expect(await resolveProductionScope(admin.id, "ADMIN", PAIRS)).toEqual({ scope: { departments: null }, note: null });
    expect(await resolveProductionScope(director.id, "DIRECTOR", PAIRS)).toEqual({ scope: { departments: null }, note: null });
  });

  it("BOSS зөвхөн өөрийн хэлтсийн цех", async () => {
    const dept = await mkDept("Тенсиланд хэсэг");
    const boss = await mkUser("b1", "BOSS", dept.id);
    expect(await resolveProductionScope(boss.id, "BOSS", PAIRS)).toEqual({ scope: { departments: ["тенсиланд хэсэг"] }, note: null });
  });

  it("BOSS тэргүүлдэг хэлтсүүд нь мөн орно; архивласан хэлтэс орохгүй", async () => {
    const own = await mkDept("Тенсиланд хэсэг");
    const boss = await mkUser("b2", "BOSS", own.id);
    await mkDept("Арматурын хэсэг", boss.id);
    const archived = await mkDept("Төмөр бетон хийц эдлэлийн цех", boss.id);
    await prisma.department.update({ where: { id: archived.id }, data: { archivedAt: new Date() } });
    const r = await resolveProductionScope(boss.id, "BOSS", PAIRS);
    expect([...(r.scope.departments ?? [])].sort()).toEqual(["арматурын хэсэг", "тенсиланд хэсэг"]);
  });

  it("ТБХЭЦ-ийн BOSS: эх хэлтсийн нэрээр дэд хэлтсүүд орно", async () => {
    const dept = await mkDept(TBHC);
    const boss = await mkUser("b5", "BOSS", dept.id);
    const r = await resolveProductionScope(boss.id, "BOSS", TREE);
    expect(r.note).toBeNull();
    expect(r.scope.departments).toContain("тенсиланд хэсэг");
    expect(r.scope.departments).toContain("баз 3");
    expect(r.scope.departments).not.toContain("арматурын хэсэг");
  });

  it("BOSS-ийн хэлтэс цехтэй тохирохгүй, эсвэл хэлтэсгүй бол хоосон жагсаалт + тайлбар (олон өгөгдөл ил гарахгүй)", async () => {
    const office = await mkDept("Санхүүгийн алба");
    const boss = await mkUser("b3", "BOSS", office.id);
    expect(await resolveProductionScope(boss.id, "BOSS", PAIRS)).toEqual({ scope: { departments: [] }, note: SCOPE_NOTE_NO_MATCH });
    const lonely = await mkUser("b4", "BOSS", null);
    expect(await resolveProductionScope(lonely.id, "BOSS", PAIRS)).toEqual({ scope: { departments: [] }, note: SCOPE_NOTE_NO_MATCH });
  });

  it("BOSS-ийн scope view-д: өөрийн цехээс өөр гарц, бутлуур, цех харагдахгүй; тохирохгүй бол хоосон", () => {
    const row = (department: string, product: string, stage: ProductionLineRow["stage"] = "finished"): ProductionLineRow => ({ day: "2098-04-02", docRef: department + product, docNumber: "X", posted: true, stage, department, product, unit: "ш", quantity: 10 });
    const lines = [row("Тенсиланд хэсэг", "Шон"), row("Төмөр бетон хийц эдлэлийн цех", "Дэр"), row("Бутлан ангилах үйлдвэр", "Элс", "crusher")];
    const own = buildProductionView({ month: "2098-04", current: "2098-04", today: "2098-04-02", lines, ledger: [], scope: { departments: matchDepartments(["Тенсиланд хэсэг"], ONEC) } });
    expect(own.products.map((p) => p.name)).toEqual(["Шон"]);
    expect(own.departments.map((d) => d.name)).toEqual(["Тенсиланд хэсэг"]);
    expect(own.crusher).toBeNull();
    const none = buildProductionView({ month: "2098-04", current: "2098-04", today: "2098-04-02", lines, ledger: [], scope: { departments: matchDepartments(["Санхүүгийн алба"], ONEC) } });
    expect(none.empty).toBe(true);
    expect(none.products).toEqual([]);
  });
});
