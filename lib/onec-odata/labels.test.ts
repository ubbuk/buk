/// <reference types="vite/client" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { groupObjects } from "../../components/onec-odata/grouping";
import { loadPolicy, objectAllowed, type Viewer } from "./access";
import { renderLabelsDoc } from "./labels-doc";
import { FIELDS, OBJECT_GROUPS, OBJECTS, TABULAR_PARTS, VIRTUAL_TABLES, fieldLabel, isTechnicalObject, matchesSearch, objectLabel } from "./labels-mn";

const V = (role: string, canViewPayroll = false): Viewer => ({ role, canViewPayroll });

describe("object labels", () => {
  it("covers 80-110 objects, with no empty label and no key defined twice", () => {
    const total = OBJECT_GROUPS.reduce((n, g) => n + Object.keys(g.items).length, 0);
    expect(total).toBeGreaterThanOrEqual(80);
    expect(total).toBeLessThanOrEqual(110);
    expect(Object.keys(OBJECTS)).toHaveLength(total); // a key in two groups would silently override
    for (const [group, labels] of [["objects", OBJECTS], ["tabular", TABULAR_PARTS], ["virtual", VIRTUAL_TABLES], ["fields", FIELDS]] as const) {
      for (const [k, v] of Object.entries(labels)) {
        expect(v.trim(), `${group} ${k}`).not.toBe("");
        expect(v, `${group} ${k}`).toBe(v.trim());
      }
    }
  });

  it("translates every object the request names, with the accounting terms asked for", () => {
    const asked: Record<string, string> = {
      Catalog_Номенклатура: "Бараа материал",
      Catalog_Контрагенты: "Харилцагч",
      Document_ТребованиеНакладная: "Шаардах хуудас",
      Document_ПоступлениеНаРасчетныйСчет: "Банкны орлого",
      Document_СписаниеСРасчетногоСчета: "Банкны зарлага",
      Document_РасходныйКассовыйОрдер: "Кассын зарлагын баримт",
    };
    for (const [name, label] of Object.entries(asked)) expect(objectLabel(name), name).toBe(label);
    const names = [
      "Номенклатура", "Контрагенты", "ДоговорыКонтрагентов", "Склады", "Организации", "ПодразделенияОрганизаций", "БанковскиеСчета", "Банки", "Валюты", "ОсновныеСредства",
      "КлассификаторЕдиницИзмерения", "НоменклатурныеГруппы", "СтатьиЗатрат",
    ];
    for (const n of names) expect(objectLabel(`Catalog_${n}`), n).toBeTruthy();
    const docs = [
      "ПоступлениеТоваровУслуг", "РеализацияТоваровУслуг", "ТребованиеНакладная", "ПеремещениеТоваров", "СписаниеТоваров", "ОприходованиеТоваров", "ИнвентаризацияТоваровНаСкладе",
      "ВозвратТоваровПоставщику", "ВозвратТоваровОтПокупателя", "ПоступлениеНаРасчетныйСчет", "СписаниеСРасчетногоСчета", "ПриходныйКассовыйОрдер", "РасходныйКассовыйОрдер",
      "АвансовыйОтчет", "СчетНаОплатуПокупателю", "ОперацияБух",
    ];
    for (const n of docs) expect(objectLabel(`Document_${n}`), n).toBeTruthy();
  });

  it("translates a tabular part as «<object> — <part>» and a virtual table likewise; no label when the parent has none", () => {
    expect(objectLabel("Document_ПоступлениеТоваровУслуг_Товары")).toBe("Бараа, үйлчилгээний орлого — Бараа");
    expect(objectLabel("Document_РеализацияТоваровУслуг_Услуги")).toBe("Бараа, үйлчилгээний борлуулалт — Үйлчилгээ");
    expect(objectLabel("Document_ПриходныйКассовыйОрдер_РасшифровкаПлатежа")).toBe("Кассын орлогын баримт — Төлбөрийн задаргаа");
    expect(objectLabel("AccumulationRegister_ТоварыНаСкладах_Balance")).toBe("Агуулах дахь бараа — Үлдэгдэл");
    expect(objectLabel("Document_НеизвестныйДокумент_Товары")).toBeNull();
    expect(objectLabel("Document_ПоступлениеТоваровУслуг_НеизвестнаяЧасть")).toBeNull();
  });

  it("an object without a translation, an unknown prefix or a prototype key has no label", () => {
    expect(objectLabel("Catalog_НеизвестныйЛавлах")).toBeNull();
    expect(objectLabel("Whatever")).toBeNull();
    expect(objectLabel("Catalog_constructor")).toBeNull();
    expect(objectLabel("Catalog___proto__")).toBeNull();
    expect(fieldLabel("constructor")).toBeNull();
    expect(fieldLabel("__proto__")).toBeNull();
    expect(fieldLabel("toString_Key")).toBeNull();
  });

  it("a name two kinds share is told apart by its full name", () => {
    expect(objectLabel("ChartOfAccounts_Хозрасчетный")).toBe("Нягтлан бодох бүртгэлийн дансны төлөвлөгөө");
    expect(objectLabel("AccountingRegister_Хозрасчетный")).toBe("Нягтлан бодох бүртгэлийн регистр");
  });
});

describe("field labels", () => {
  it("translates the common fields, the _Key suffix and an expanded reference", () => {
    const expected: Record<string, string> = {
      Code: "Код", Description: "Нэр", Date: "Огноо", Number: "Дугаар", Posted: "Батлагдсан", DeletionMark: "Устгах тэмдэг", Контрагент: "Харилцагч",
      ДоговорКонтрагента: "Гэрээ", Номенклатура: "Бараа", Склад: "Агуулах", Количество: "Тоо хэмжээ", Цена: "Үнэ", Сумма: "Дүн", СуммаНДС: "НӨАТ",
      СуммаДокумента: "Баримтын дүн", Организация: "Байгууллага", Подразделение: "Хэлтэс", Комментарий: "Тайлбар", Ответственный: "Хариуцагч", ЕдиницаИзмерения: "Хэмжих нэгж",
    };
    for (const [k, v] of Object.entries(expected)) expect(fieldLabel(k), k).toBe(v);
    expect(fieldLabel("Контрагент_Key")).toBe("Харилцагч (ID)");
    expect(fieldLabel("Организация_Key")).toBe("Байгууллага (ID)");
    expect(fieldLabel("НеизвестноеПоле")).toBeNull();
    expect(fieldLabel("НеизвестноеПоле_Key")).toBeNull();
  });
});

describe("technical objects", () => {
  it("recognises the technical kinds and leaves ordinary objects alone", () => {
    for (const n of [
      "Constant_ОсновнаяВалюта", "ExchangePlan_ОбменДанными", "InformationRegister_КурсыВалют_RecordType", "AccumulationRegister_Закупки_RecordType",
      "Catalog_Номенклатура_ДополнительныеРеквизиты", "InformationRegister_ДополнительныеСведения", "Catalog_НоменклатураПрисоединенныеФайлы", "InformationRegister_ВерсииФайлов",
    ]) expect(isTechnicalObject(n), n).toBe(true);
    for (const n of ["Catalog_Номенклатура", "Document_РеализацияТоваровУслуг", "Document_ПоступлениеТоваровУслуг_Товары", "AccumulationRegister_ТоварыНаСкладах"]) expect(isTechnicalObject(n), n).toBe(false);
  });
});

describe("search and grouping (display only)", () => {
  const objects = [
    { name: "Catalog_Склады", kind: "catalog" },
    { name: "Catalog_Номенклатура", kind: "catalog" },
    { name: "Catalog_НеизвестныйЯ", kind: "catalog" },
    { name: "Catalog_АнхныйНеизвестный", kind: "catalog" },
    { name: "Catalog_Контрагенты", kind: "catalog" },
    { name: "Document_РеализацияТоваровУслуг", kind: "document" },
    { name: "Catalog_Номенклатура_ПрисоединенныеФайлы", kind: "catalog" },
    { name: "Constant_Валюта", kind: "other" },
    { name: "ExchangePlan_Обмен", kind: "other" },
    { name: "InformationRegister_КурсыВалют_RecordType", kind: "register" },
    { name: "AccumulationRegister_ТоварыНаСкладах", kind: "register" },
  ];

  it("searches the Mongolian name and the real 1С name, ignoring case", () => {
    expect(matchesSearch("Catalog_Контрагенты", "харилцагч")).toBe(true); // Mongolian
    expect(matchesSearch("Catalog_Контрагенты", "ХАРИЛЦАГЧ")).toBe(true);
    expect(matchesSearch("Catalog_Контрагенты", "контрагент")).toBe(true); // real name
    expect(matchesSearch("Catalog_Контрагенты", "catalog_")).toBe(true);
    expect(matchesSearch("Catalog_Контрагенты", "агуулах")).toBe(false);
    expect(matchesSearch("Catalog_Контрагенты", "  ")).toBe(true);
    expect(groupObjects(objects, "харилцагч").flatMap((g) => g.items.map((o) => o.name))).toEqual(["Catalog_Контрагенты"]);
    expect(groupObjects(objects, "контрагенты").flatMap((g) => g.items.map((o) => o.name))).toEqual(["Catalog_Контрагенты"]);
  });

  it("lists translated objects first, in Mongolian alphabetical order, then untranslated ones by their real name", () => {
    const catalog = groupObjects(objects, "").find((g) => g.kind === "catalog")!.items.map((o) => o.name);
    // Агуулах (Склады) < Бараа материал (Номенклатура) < Харилцагч (Контрагенты); дараа нь орчуулгагүй нь жинхэнэ нэрээр
    expect(catalog).toEqual(["Catalog_Склады", "Catalog_Номенклатура", "Catalog_Контрагенты", "Catalog_АнхныйНеизвестный", "Catalog_НеизвестныйЯ"]);
  });

  it("puts technical objects in a separate last group, whatever their kind", () => {
    const groups = groupObjects(objects, "");
    expect(groups.map((g) => g.kind)).toEqual(["catalog", "document", "register", "technical"]);
    expect(groups.at(-1)!.items.map((o) => o.name).sort()).toEqual(
      ["Catalog_Номенклатура_ПрисоединенныеФайлы", "Constant_Валюта", "ExchangePlan_Обмен", "InformationRegister_КурсыВалют_RecordType"].sort()
    );
    for (const g of groups.slice(0, -1)) for (const o of g.items) expect(isTechnicalObject(o.name)).toBe(false);
  });
});

describe("labels never take part in access decisions (the real 1С name decides)", () => {
  const sources = import.meta.glob(["/lib/onec-odata/*.ts", "/app/api/onec-odata/**/*.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

  it("no server-side module imports the labels", () => {
    const importers = Object.entries(sources)
      .filter(([path]) => !/\/(labels-mn|labels-doc)\.ts$/.test(path) && !path.endsWith(".test.ts"))
      .filter(([, text]) => /labels-mn|labels-doc/.test(text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")))
      .map(([path]) => path);
    expect(importers).toEqual([]);
  });

  it("DENY / PAYROLL / ALLOW match the 1С name only: the Mongolian label of an object neither hides nor opens it", () => {
    // «Ажилтан» is the Mongolian label of Catalog_Сотрудники, but the policy is written against the real name
    const policy = loadPolicy({ ONEC_ODATA_DENY: "Ажилтан", ONEC_ODATA_PAYROLL: "Хувь хүн", ONEC_ODATA_STOREKEEPER_ALLOW: "Бараа материал" });
    expect(objectLabel("Catalog_Сотрудники")).toBe("Ажилтан");
    expect(objectAllowed(V("ADMIN"), "Catalog_Сотрудники", policy)).toBe(true); // not denied by its label
    expect(objectAllowed(V("ADMIN"), "Catalog_ФизическиеЛица", policy)).toBe(true); // not payroll by its label
    expect(objectAllowed(V("STOREKEEPER"), "Catalog_Номенклатура", policy)).toBe(false); // not allowed by its label

    const real = loadPolicy({ ONEC_ODATA_DENY: "Сертификат", ONEC_ODATA_PAYROLL: "Сотрудник", ONEC_ODATA_STOREKEEPER_ALLOW: "Номенклатура" });
    expect(objectAllowed(V("ADMIN"), "Catalog_Сотрудники", real)).toBe(false); // PAYROLL by its real name, though it has a Mongolian label
    expect(objectAllowed(V("ADMIN", true), "Catalog_Сотрудники", real)).toBe(true);
    expect(objectAllowed(V("STOREKEEPER"), "Catalog_Номенклатура", real)).toBe(true);
    expect(objectAllowed(V("STOREKEEPER"), "Catalog_Склады", real)).toBe(false);
  });

  it("for every translated object the decision equals the decision on its real name alone, for any pattern list", () => {
    const names = [...Object.keys(OBJECTS).map((k) => (k.includes("_") ? k : `Catalog_${k}`)), "Document_ПоступлениеТоваровУслуг_Товары"];
    // patterns that are Mongolian labels (must never match) and real-name fragments (must match as a substring)
    const mongolian = Object.values(OBJECTS).slice(0, 30);
    for (const name of names) {
      const label = objectLabel(name);
      for (const pat of [...mongolian, "Склад", "Номенклатура"]) {
        const policy = { deny: [pat], payroll: [], storekeeperAllow: [] };
        expect(objectAllowed(V("ADMIN"), name, policy), `${name} / ${pat}`).toBe(!name.toLowerCase().includes(pat.toLowerCase()));
      }
      expect(label === null || typeof label === "string").toBe(true);
    }
  });

  it("the data API and the object list answer with the real names only (labels are added by the browser)", () => {
    const routeText = Object.entries(sources).filter(([p]) => p.startsWith("/app/api/onec-odata/") && !p.endsWith(".test.ts")).map(([, t]) => t).join("\n");
    expect(routeText).not.toMatch(/objectLabel|fieldLabel|OBJECT_GROUPS/);
  });
});

describe("docs/onec-labels-mn.md", () => {
  it("is generated from labels-mn.ts and in sync with it (run `npm run onec:labels-doc` after changing the labels)", () => {
    const onDisk = readFileSync(new URL("../../docs/onec-labels-mn.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    expect(onDisk).toBe(renderLabelsDoc());
  });

  it("lists every object, tabular part, virtual table and field with its Mongolian name", () => {
    const doc = renderLabelsDoc();
    for (const [k, v] of [...Object.entries(OBJECTS), ...Object.entries(TABULAR_PARTS), ...Object.entries(VIRTUAL_TABLES), ...Object.entries(FIELDS)]) {
      expect(doc, k).toContain(`| \`${k}\` | ${v} |`);
    }
  });
});
