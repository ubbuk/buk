// 1С OData-ийн объектуудыг жагсааж, DENY / PAYROLL / STOREKEEPER_ALLOW-ийн САНАЛ болон бодит (effective) үр дүнг хэвлэнэ.
// Зөвхөн унших; нууц үг, хэрэглэгчийн нэр, хаягийг хэзээ ч хэвлэхгүй. Санал нь батлах зорилготой: .env-ийг та өөрөө шийднэ.
//
//   npm run onec:objects                  -> $metadata-аас: DENY, PAYROLL, няравт нээх объектын санал
//   npm run onec:objects -- --split       -> ОДООГИЙН ONEC_ODATA_DENY-г DENY (үлдэх) ба PAYROLL (шилжих) гэж хуваах санал (сүлжээгүй)
//   npm run onec:objects -- --effective   -> .env-ийн бодит DENY/PAYROLL/ALLOW-оор: хэн ч харахгүй, няравт нээлттэй, цалингийн эрхтэй хүнд л нээлттэй
//   npm run onec:objects -- --all         -> (санал горимд) бүх объектын нэрийг мөн хэвлэнэ
import { loadPolicy, objectAllowed, type Viewer } from "../lib/onec-odata/access";
import { parseList } from "../lib/onec-odata/config";
import { getMetadata } from "../lib/onec-odata/service";

// Хэн ч харах ёсгүй: нууц түлхүүр, гарын үсэг, имэйлийн бүртгэл (DENY-д үлдэнэ)
const SECRET = [
  "Сертификат", "ЭлектроннаяПодпись", "ЭлектронныеПодписи", "ЭЦП", "ПодписьЭлектронная", "УчетнаяЗаписьЭлектроннойПочты", "УчетныеЗаписиЭлектроннойПочты",
  "Подпис", "Шифрован", "Certificate", "Signature", "Password", "Пароль",
];
// Цалин, ажилтан, хувь хүн: зөвхөн canViewPayroll эрхтэй хүнд (PAYROLL руу шилжинэ)
const PAYROLL = [
  "Зарплат", "Начислен", "Удержан", "Сотрудник", "ФизическиеЛица", "ФизическоеЛицо", "Кадров", "Отпуск", "Больнич", "Табель", "Штатн",
  "НДФЛ", "Алимент", "ПерсональныеДанные", "Трудов", "Увольнен", "ПриемНаРаботу", "Командировк", "Цалин", "Ажилтан",
  "Salary", "Payroll", "Employee", "Staff", "Individual", "Person",
];
const WAREHOUSE = ["Номенклатура", "Склад", "Товар", "Партии", "ЕдиницыИзмерения", "Перемещение", "Оприходование", "Списание", "Инвентаризация", "Поступление", "Реализация", "ВидыНоменклатуры", "Номенклатурные"];

const includes = (name: string, pattern: string) => name.toLowerCase().includes(pattern.toLowerCase());
const isSecret = (pattern: string) => SECRET.some((s) => includes(pattern, s) || includes(s, pattern));

// --split: сүлжээ хэрэггүй. Одоогийн DENY бичлэг бүрийг: нууц зүйл бол DENY-д үлдээх, бусад (цалин, ажилтан, хувь хүн) бол PAYROLL руу.
function split() {
  const current = parseList(process.env.ONEC_ODATA_DENY);
  if (current.length === 0) throw new Error("ONEC_ODATA_DENY хоосон байна: хуваах зүйл алга");
  const stay = current.filter(isSecret);
  const move = current.filter((p) => !isSecret(p));
  console.log(`Одоогийн DENY (${current.length}): ${current.join(", ")}\n`);
  console.log(`DENY-д ҮЛДЭХ (сертификат, цахим гарын үсэг, имэйлийн бүртгэл) — ${stay.length}:`);
  for (const p of stay) console.log(`  ${p}`);
  console.log(`\nPAYROLL руу ШИЛЖИХ (цалин, ажилтан, хувь хүн) — ${move.length}:`);
  for (const p of move) console.log(`  ${p}`);
  const missing = SECRET.filter((s) => !current.some((c) => includes(s, c) || includes(c, s)));
  console.log(`\nСанал (та засаж батлана):\nONEC_ODATA_DENY="${[...stay, ...(stay.length === 0 ? ["Сертификат", "ЭлектроннаяПодпись", "УчетныеЗаписиЭлектроннойПочты"] : [])].join(",")}"`);
  console.log(`ONEC_ODATA_PAYROLL="${move.join(",")}"`);
  if (missing.length) console.log(`\nАнхаар: одоогийн DENY-д алга, гэхдээ DENY-д орох магадлалтай: ${missing.slice(0, 6).join(", ")} … (npm run onec:objects-ээр бодит нэрийг шалгана уу)`);
}

// --effective: .env-ийн бодит тохиргоог хөтчийн ЯГ ИЖИЛ функцээр (lib/onec-odata/access.ts: loadPolicy, objectAllowed)
// ажиллуулж, эцсийн жагсаалтыг хэвлэнэ. Тусдаа логик байхгүй.
async function effective() {
  const metadata = await getMetadata();
  const names = [...metadata.keys()].sort();
  const policy = loadPolicy();
  const view = (role: string, canViewPayroll: boolean): Viewer => ({ role, canViewPayroll });

  // 1) Цалингийн эрхтэй ADMIN ч харахгүй = DENY (хэн ч харахгүй)
  const closedToEveryone = names.filter((n) => !objectAllowed(view("ADMIN", true), n, policy));
  // 2) Нярав (цалингийн эрхгүй) харах
  const openToStorekeeper = names.filter((n) => objectAllowed(view("STOREKEEPER", false), n, policy));
  // 3) Эрх шаардсан: цалингийн эрхтэй хүнд л нээлттэй (чагтгүй ADMIN-д хаалттай)
  const payrollOnly = names.filter((n) => objectAllowed(view("ADMIN", true), n, policy) && !objectAllowed(view("ADMIN", false), n, policy));

  console.log(`DENY (${policy.deny.length}): ${policy.deny.join(", ")}`);
  console.log(`PAYROLL (${policy.payroll.length}): ${policy.payroll.join(", ")}`);
  console.log(`STOREKEEPER_ALLOW (${policy.storekeeperAllow.length}): ${policy.storekeeperAllow.join(", ")}`);
  console.log(`Нийт объект: ${names.length}\n`);
  console.log(`--- 1) ХЭН Ч ХАРАХГҮЙ — DENY (${closedToEveryone.length}) ---`);
  for (const n of closedToEveryone) console.log(`  ${n}`);
  console.log(`\n--- 2) НЯРАВТ НЭЭЛТТЭЙ, DENY/PAYROLL-г хассаны дараа (${openToStorekeeper.length}) ---`);
  for (const n of openToStorekeeper) console.log(`  ${n}`);
  console.log(`\n--- 3) ЗӨВХӨН ЦАЛИНГИЙН ЭРХТЭЙ ХҮНД НЭЭЛТТЭЙ — PAYROLL (${payrollOnly.length}) ---`);
  for (const n of payrollOnly) console.log(`  ${n}`);
}

async function main() {
  if (process.argv.includes("--split")) return split();
  if (process.argv.includes("--effective")) return effective();

  const metadata = await getMetadata();
  const names = [...metadata.keys()].sort();
  const hit = (list: string[]) => names.filter((n) => list.some((p) => includes(n, p)));
  const used = (list: string[]) => list.filter((p) => names.some((n) => includes(n, p)));
  const counts = new Map<string, number>();
  for (const e of metadata.values()) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  console.log(`Нийт объект: ${names.length}  (${[...counts].map(([k, n]) => `${k}: ${n}`).join(", ")})\n`);

  const secret = hit(SECRET);
  console.log(`--- DENY-д орох магадлалтай: нууц, гарын үсэг, имэйлийн бүртгэл (${secret.length}) ---`);
  for (const n of secret) console.log(`  ${n}`);
  console.log(`\nСанал: ONEC_ODATA_DENY="${used(SECRET).join(",")}"\n`);

  const payroll = hit(PAYROLL).filter((n) => !secret.includes(n));
  console.log(`--- PAYROLL-д орох магадлалтай: цалин, ажилтан, хувь хүн (${payroll.length}) ---`);
  for (const n of payroll) console.log(`  ${n}`);
  console.log(`\nСанал: ONEC_ODATA_PAYROLL="${used(PAYROLL).join(",")}"\n`);

  const stock = hit(WAREHOUSE).filter((n) => !secret.includes(n) && !payroll.includes(n));
  console.log(`--- Няравт нээх байж болох объектууд (${stock.length}) ---`);
  for (const n of stock) console.log(`  ${n}`);
  console.log(`\nСанал: ONEC_ODATA_STOREKEEPER_ALLOW="${used(WAREHOUSE).join(",")}"\n`);

  if (process.argv.includes("--all")) {
    console.log("--- Бүх объект ---");
    for (const n of names) console.log(`  ${n}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
