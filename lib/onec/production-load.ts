// «Үйлдвэрлэл» захирлын харагдацын API-уудын нийтлэг ачаалалт: сонгосон өдрийн сар, өнөөдрийн сар, өмнөх сарын мөрүүд (анхдагч өдөр олох), эрхийн хүрээ.
// 1С руу хандахгүй: sync-ийн бичсэн агшин зургаас.
import { addDays, addMonths, currentMonth, isDate, today } from "./dates";
import { groupFor } from "./production-groups";
import { resolveProductionScope } from "./production-scope";
import { readLastReports, readProductionMonths } from "./production-store";

/** «Сүүлд» өдрийг олох цонх: хэтэрхий хуучин тайланг үл тооно */
const LAST_REPORT_DAYS = 400;

export async function loadProduction(user: { id: string; role: string }, dayParam: string | null) {
  const now = today();
  const cur = currentMonth();
  const requested = isDate(dayParam) && dayParam <= now ? dayParam : null;
  const months = [...new Set([requested?.slice(0, 7), cur, addMonths(cur, -1)].filter((m): m is string => !!m))].sort();
  const [rows, lastReports] = await Promise.all([readProductionMonths(months), readLastReports(addDays(now, -(LAST_REPORT_DAYS - 1)))]);
  const pairs = [...new Set([...rows.lines.map((l) => l.department), ...lastReports.map((r) => r.department)])].map((d) => ({ department: d, group: groupFor(d).name }));
  const { scope, note } = await resolveProductionScope(user.id, user.role, pairs);
  return { now, requested, rows, lastReports, scope, note };
}
