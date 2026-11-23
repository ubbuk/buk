// «Борлуулалт» табын харагдац (цэвэр функц, Postgres-ийн onec_sales-аас): орлого, өртөг, ашиг; харилцагчаар, бүтээгдэхүүнээр. Харилцагч
// бүрд худалдан авсан бүтээгдэхүүн (тоо хэмжээ нэгжтэй + ₮), бүтээгдэхүүн бүрд худалдан авагчид.
// Өртөг = борлуулсан барааны өртөг (борлуулалтын баримтаар) + цехээс шууд зарцуулсан материал (шаардах хуудсаар, борлуулалттай холбогдоогүй):
// нийт ашиг = орлого − нийт өртөг (хуучин «Бохир ашиг»-тай ижил тоо). Харилцагч, бүтээгдэхүүний ашиг зөвхөн борлуулсан барааны өртгөөр.
import { sumQuantities, type Quantity } from "@/lib/units";

export interface SalesLine {
  client_code: string;
  client: string;
  item_code: string;
  item: string;
  unit: string;
  qty: number;
  revenue: number;
  cost: number;
  /** шаардах хуудсаар шууд өртөгт бичсэн (борлуулалт биш) */
  direct: boolean;
}

export interface SalesKpi {
  revenue: number;
  cost: number;
  /** өртгийн задаргаа: борлуулсан барааны өртөг, цехээс шууд зарцуулсан материал */
  costOfGoods: number;
  costDirect: number;
  profit: number;
  /** ашгийн хувь (0..100), орлого 0 бол null */
  margin: number | null;
}

export interface SalesProduct {
  code: string;
  name: string;
  unit: string;
  qty: number;
  revenue: number;
  profit: number;
}
export interface SalesClient {
  code: string;
  name: string;
  revenue: number;
  cost: number;
  profit: number;
  margin: number | null;
  /** нэгж бүрээр тусдаа */
  quantities: Quantity[];
  products: SalesProduct[];
}
export interface SalesItem {
  code: string;
  name: string;
  unit: string;
  qty: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number | null;
  clients: { code: string; name: string; qty: number; revenue: number }[];
}

export interface SalesView {
  kpi: SalesKpi;
  clients: SalesClient[];
  items: SalesItem[];
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const pct = (profit: number, revenue: number) => (revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : null);
export const UNKNOWN_CLIENT = "Тодорхойгүй харилцагч";

export function buildSalesView(lines: readonly SalesLine[]): SalesView {
  let revenue = 0;
  let costOfGoods = 0;
  let costDirect = 0;
  const clients = new Map<string, SalesClient>();
  const items = new Map<string, SalesItem>();

  for (const l of lines) {
    revenue += l.revenue;
    if (l.direct) {
      costDirect += l.cost;
      continue; // борлуулалтад хамаарахгүй: харилцагч, бүтээгдэхүүний жагсаалтад орохгүй
    }
    costOfGoods += l.cost;

    const ck = l.client_code || l.client || "?";
    const c = clients.get(ck) ?? { code: l.client_code, name: l.client || UNKNOWN_CLIENT, revenue: 0, cost: 0, profit: 0, margin: null, quantities: [], products: [] };
    c.revenue += l.revenue;
    c.cost += l.cost;
    const pk = l.item_code || l.item;
    const cp = c.products.find((p) => p.code === l.item_code && p.name === (l.item || l.item_code) && p.unit === l.unit);
    if (cp) {
      cp.qty += l.qty;
      cp.revenue += l.revenue;
      cp.profit += l.revenue - l.cost;
    } else c.products.push({ code: l.item_code, name: l.item || l.item_code || "Бараа тодорхойгүй", unit: l.unit, qty: l.qty, revenue: l.revenue, profit: l.revenue - l.cost });
    clients.set(ck, c);

    const i = items.get(pk) ?? { code: l.item_code, name: l.item || l.item_code || "Бараа тодорхойгүй", unit: l.unit, qty: 0, revenue: 0, cost: 0, profit: 0, margin: null, clients: [] };
    i.qty += l.qty;
    i.revenue += l.revenue;
    i.cost += l.cost;
    const ic = i.clients.find((x) => x.code === l.client_code && x.name === (l.client || UNKNOWN_CLIENT));
    if (ic) {
      ic.qty += l.qty;
      ic.revenue += l.revenue;
    } else i.clients.push({ code: l.client_code, name: l.client || UNKNOWN_CLIENT, qty: l.qty, revenue: l.revenue });
    items.set(pk, i);
  }

  const byRevenue = <T extends { revenue: number; name: string }>(a: T, b: T) => b.revenue - a.revenue || a.name.localeCompare(b.name, "mn");
  const clientList = [...clients.values()].map((c) => {
    const profit = c.revenue - c.cost;
    return {
      ...c,
      revenue: round2(c.revenue),
      cost: round2(c.cost),
      profit: round2(profit),
      margin: pct(profit, c.revenue),
      quantities: sumQuantities(c.products),
      products: c.products.map((p) => ({ ...p, qty: Math.round(p.qty * 1000) / 1000, revenue: round2(p.revenue), profit: round2(p.profit) })).sort(byRevenue),
    };
  });
  const itemList = [...items.values()].map((i) => {
    const profit = i.revenue - i.cost;
    return {
      ...i,
      qty: Math.round(i.qty * 1000) / 1000,
      revenue: round2(i.revenue),
      cost: round2(i.cost),
      profit: round2(profit),
      margin: pct(profit, i.revenue),
      clients: i.clients.map((x) => ({ ...x, qty: Math.round(x.qty * 1000) / 1000, revenue: round2(x.revenue) })).sort(byRevenue),
    };
  });

  const cost = costOfGoods + costDirect;
  return {
    kpi: { revenue: round2(revenue), cost: round2(cost), costOfGoods: round2(costOfGoods), costDirect: round2(costDirect), profit: round2(revenue - cost), margin: pct(revenue - cost, revenue) },
    clients: clientList.sort(byRevenue),
    items: itemList.sort(byRevenue),
  };
}

export interface SalesReconciliation {
  /** жагсаалтын (харилцагч эсвэл бүтээгдэхүүн) ашгийн нийлбэр */
  listProfit: number;
  /** харилцагчид хуваарилагдаагүй зардал (сөрөг): цехээс шууд зарцуулсан материал */
  unassigned: number;
  /** жагсаалтын нийлбэр + хуваарилагдаагүй зардал = нийт ашиг */
  total: number;
  /** нийт ашиг дээд талын «Ашиг»-тай таарч байна */
  matches: boolean;
}

/** Жагсаалтын нийлбэр дээд талын Ашигтай таарах тулгалт: Σ ашиг (харилцагчаар) − хуваарилагдаагүй зардал = нийт ашиг. */
export function reconcileSales(view: Pick<SalesView, "kpi" | "clients">): SalesReconciliation {
  const listProfit = round2(view.clients.reduce((s, c) => s + c.profit, 0));
  const unassigned = round2(-view.kpi.costDirect) || 0; // -0 биш 0
  const total = round2(listProfit + unassigned);
  return { listProfit, unassigned, total, matches: Math.abs(total - view.kpi.profit) < 0.01 };
}
