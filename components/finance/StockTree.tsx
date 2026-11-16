"use client";

import { ChevronRight, UserRound } from "lucide-react";
import { useState } from "react";
import { cn, formatNumber } from "@/lib/utils";
import { money } from "./FinanceShell";
import { unknownTitle, type KeeperRef, type StockGroupNode, type StockRow, type StockWarehouseNode } from "@/lib/onec/stock-tree";

// Нэг удаад харуулах барааны мөр: олон мөртэй складыг нээхэд хуудас удаашрахгүй, «Дахиад харуулах»-аар нэмнэ
export const PAGE_SIZE = 50;

/** «Нярав: <нэр>» эсвэл саарал «Нярав оноогоогүй». Нэр нь Warehouse.keeperId → User-ээс ирнэ. */
export function KeeperLabel({ keeper }: { keeper: KeeperRef | null }) {
  return keeper ? (
    <span className="inline-flex items-center gap-1 text-text-muted">
      <UserRound className="size-3 shrink-0" aria-hidden />
      Нярав: <span className="text-text">{keeper.name}</span>
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-text-muted/70">
      <UserRound className="size-3 shrink-0" aria-hidden />
      Нярав оноогоогүй
    </span>
  );
}

export function Toggle({ open, onClick, controls, children, level }: { open: boolean; onClick: () => void; controls: string; children: React.ReactNode; level: 1 | 2 }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      aria-controls={controls}
      className={cn("focus-ring flex w-full items-start gap-2 text-left transition-colors hover:bg-bg-elevated/60", level === 1 ? "px-4 py-3" : "py-2.5 pl-8 pr-4")}
    >
      <ChevronRight className={cn("mt-0.5 size-4 shrink-0 text-text-muted transition-transform", open && "rotate-90")} aria-hidden />
      {children}
    </button>
  );
}

/** Нэр, нярав (зүүн) ба нийт дүн, барааны тоо (баруун). Нарийн дэлгэц дээр дүн нэрийн доор шилжинэ. */
function Summary({ title, sub, amount, items, badge }: { title: string; sub?: React.ReactNode; amount: number; items: number; badge?: React.ReactNode }) {
  return (
    <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-medium text-text [overflow-wrap:anywhere]">{title}</span>
          {badge}
        </span>
        {sub && <span className="mt-0.5 block text-xs">{sub}</span>}
      </span>
      <span className="ml-auto shrink-0 text-right">
        <span className={cn("block font-semibold tabular-nums", amount < 0 ? "text-danger" : "text-text")}>{money(amount)}</span>
        <span className="block text-[11px] text-text-muted">{formatNumber(items, 0)} бараа</span>
      </span>
    </span>
  );
}

function ItemRow({ r }: { r: StockRow }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 border-t border-border/60 py-2 pl-14 pr-4 text-sm">
      <div className="min-w-0">
        <p className="text-text [overflow-wrap:anywhere]">{r.item || "—"}</p>
        <p className="text-[11px] text-text-muted">{r.item_code}</p>
      </div>
      <p className={cn("text-right font-medium tabular-nums", r.amount < 0 ? "text-danger" : "text-text")}>{money(r.amount)}</p>
      <p className={cn("col-span-2 text-xs tabular-nums", r.qty < 0 ? "text-danger" : "text-text-muted")}>
        {formatNumber(r.qty, 2)} {r.unit}
        {r.unit_cost != null && <span className="text-text-muted"> · нэгж {money(r.unit_cost)}</span>}
      </p>
    </li>
  );
}

/** «Дахиад харуулах (N үлдсэн)»: олон мөртэй жагсаалтыг PAGE_SIZE-аар нэмж харуулна (хуудас удаашрахгүй) */
export function ShowMore({ remaining, onClick }: { remaining: number; onClick: () => void }) {
  return (
    <div className="border-t border-border/60 py-2 pl-14 pr-4">
      <button type="button" onClick={onClick} className="focus-ring rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text hover:bg-bg-elevated">
        Дахиад харуулах ({formatNumber(remaining, 0)} үлдсэн)
      </button>
    </div>
  );
}

/** Барааны мөрүүд, PAGE_SIZE-аар нэмж харуулна */
function ItemList({ rows }: { rows: StockRow[] }) {
  const [shown, setShown] = useState(PAGE_SIZE);
  return (
    <>
      <ul>
        {rows.slice(0, shown).map((r) => (
          <ItemRow key={r.id} r={r} />
        ))}
      </ul>
      {rows.length > shown && <ShowMore remaining={rows.length - shown} onClick={() => setShown((n) => n + PAGE_SIZE)} />}
    </>
  );
}

function WarehouseSection({ id, w, open, onToggle }: { id: string; w: StockWarehouseNode; open: boolean; onToggle: () => void }) {
  const panel = `${id}-items`;
  return (
    <li data-testid="stock-warehouse" className="border-t border-border/60">
      <Toggle open={open} onClick={onToggle} controls={panel} level={2}>
        <Summary
          title={w.name}
          sub={<KeeperLabel keeper={w.keeper} />}
          amount={w.amount}
          items={w.items}
          badge={!w.reservable && <span className="rounded-md bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">Нөөцлөхгүй</span>}
        />
      </Toggle>
      {open && <div id={panel}>{w.rows.length === 0 ? <p className="py-2 pl-14 pr-4 text-xs text-text-muted">Энэ складад үлдэгдэл алга</p> : <ItemList rows={w.rows} />}</div>}
    </li>
  );
}

/**
 * Нярвын бүлэг → 1С склад → бараа. Анхдагчаар бүгд хураасан; хайлт идэвхтэй үед таарсан хэсгүүд нээлттэй (хэрэглэгч хаах боломжтой).
 * Тоо, дүн нь серверээс (шүүлтийг дагасан), энд зөвхөн харуулна.
 */
export function StockTree({ groups, expandAll }: { groups: StockGroupNode[]; expandAll: boolean }) {
  // expandAll үед анхдагч нээлттэй, `flipped` нь хэрэглэгчийн өөрчилсөн түлхүүрүүд
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const [prevExpandAll, setPrevExpandAll] = useState(expandAll);
  if (prevExpandAll !== expandAll) {
    setPrevExpandAll(expandAll);
    setFlipped(new Set());
  }
  const isOpen = (key: string) => expandAll !== flipped.has(key);
  const toggle = (key: string) =>
    setFlipped((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-bg-surface" data-testid="stock-tree">
      {groups.map((g) => {
        const gKey = `g:${g.key}`;
        const open = isOpen(gKey);
        const panel = `stock-g-${g.key}`;
        const title = g.kind === "unknown" ? unknownTitle(g) : g.name;
        return (
          <li key={g.key} data-testid="stock-group" data-kind={g.kind}>
            <Toggle open={open} onClick={() => toggle(gKey)} controls={panel} level={1}>
              <Summary title={title} sub={g.kind === "group" ? <KeeperLabel keeper={g.keeper} /> : undefined} amount={g.amount} items={g.items} />
            </Toggle>
            {open && (
              <ul id={panel}>
                {g.warehouses.map((w) => {
                  const wKey = `w:${g.key}/${w.key}`;
                  return g.kind === "unknown" ? (
                    // складын код хоосон: нэг л «склад» тул нэмэлт түвшин үүсгэхгүй, барааг шууд харуулна
                    <li key={w.key}>
                      <ItemList rows={w.rows} />
                    </li>
                  ) : (
                    <WarehouseSection key={w.key} id={`stock-w-${g.key}-${w.key}`} w={w} open={isOpen(wKey)} onToggle={() => toggle(wKey)} />
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
