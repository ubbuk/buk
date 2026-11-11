"use client";

import { Briefcase, Building2, Check, ChevronsRight, Clock, Cog, Coins, History, Layers, PenLine, Undo2, UserRound } from "lucide-react";
import { FT_STAGE_LABEL, type FtStatus } from "@/lib/foreign-trade-rules";
import type { FtOrderView } from "@/lib/foreign-trade";
import { cn, formatDateTime } from "@/lib/utils";
import { HoloPanel } from "./holo/HoloPanel";
import s from "./holo/holo.module.css";

// Where the order is on its way: BOSS -> MANAGER -> technical review (OR) -> finance director -> executive director ->
// finance department. The index is the stage the order currently waits in; everything before it is done.
export const STEPS = ["Цехийн дарга", "MANAGER (үнийн судалгаа)", "Техникийн хяналт (аль нэг нь)", "Санхүү хариуцсан захирал", "Гүйцэтгэх захирал", "Санхүүгийн хэлтэс"] as const;
export const CURRENT: Record<FtStatus, number> = {
  DRAFT: 0,
  RETURNED_TO_BOSS: 0,
  PENDING_MANAGER: 1,
  RETURNED_TO_MANAGER: 1,
  PENDING_TECHNICAL: 2,
  PENDING_FINANCE: 3,
  PENDING_EXECUTIVE: 4,
  APPROVED: 6,
};

/** Who the order is waiting for, in words (names of position holders are not part of the order view). */
export const WAITING_FOR: Partial<Record<FtStatus, string>> = {
  DRAFT: "Цехийн дарга захиалгаа илгээнэ",
  RETURNED_TO_BOSS: "Цехийн дарга засварлаж дахин илгээнэ",
  PENDING_MANAGER: "MANAGER үнийн судалгаа хийж, нийлүүлэгч бүртгэнэ",
  RETURNED_TO_MANAGER: "MANAGER засварлаж дахин илгээнэ",
  PENDING_TECHNICAL: "Үйлдвэр хариуцсан захирал эсвэл Ерөнхий инженер (аль нэг нь)",
  PENDING_FINANCE: "Санхүү хариуцсан захирал",
  PENDING_EXECUTIVE: "Гүйцэтгэх захирал",
};

/** "MANAGER (үнийн судалгаа)" -> ["MANAGER", "(үнийн судалгаа)"]: the stage name and its qualifier go on two lines. */
export function splitLabel(label: string): [string, string | null] {
  const i = label.indexOf(" (");
  return i < 0 ? [label, null] : [label.slice(0, i), label.slice(i + 1)];
}

/** Stage icons by position in the fixed stage list. */
const STEP_ICONS = [UserRound, Briefcase, Cog, Coins, PenLine, Building2] as const;

export function ApprovalTimeline({ order }: { order: FtOrderView }) {
  const current = CURRENT[order.status];
  const returned = order.status === "RETURNED_TO_BOSS" || order.status === "RETURNED_TO_MANAGER";
  return (
    <HoloPanel
      scan
      icon={<Layers className="size-6" />}
      title="Батлалтын явц"
      actions={
        WAITING_FOR[order.status] && (
          <span className="inline-flex items-center gap-2 text-base text-text-muted">
            <UserRound className="size-4" />
            <span>
              Хүлээгдэж буй: <strong className="font-semibold text-amber-300">{WAITING_FOR[order.status]}</strong>
            </span>
          </span>
        )
      }
    >
      <div className={s.flowScroll}>
        <ol className={s.flow}>
          {STEPS.map((label, i) => {
            const done = i < current;
            const active = i === current;
            const Icon = STEP_ICONS[i];
            const [main, sub] = splitLabel(label);
            return (
              <li key={label} className={s.flowItem}>
                <div aria-current={active ? "step" : undefined} className={cn(s.stage, done && s.stageDone, active && (returned ? s.stageReturned : s.stageActive), !done && !active && s.stageTodo)}>
                  <span className={s.iconCircle}>{done ? <Check className="size-7" strokeWidth={3.2} /> : <Icon className="size-6" />}</span>
                  <div className={s.card}>
                    <div className={s.cardIn}>
                      {/* one element holds the whole stage name; the qualifier only sits on its own line */}
                      <span className={s.label}>
                        {main}
                        {sub && (
                          <>
                            {" "}
                            <span className={s.labelSub}>{sub}</span>
                          </>
                        )}
                      </span>
                      {done && <span className={s.stateText}>Батлагдсан</span>}
                      {active && (
                        <span className={s.pill}>
                          <Clock className="size-3.5" /> {returned ? "Буцсан" : "Хүлээгдэж байна"}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className={s.beam} aria-hidden="true" />
                  <svg className={s.platform} viewBox="0 0 160 44" preserveAspectRatio="none" aria-hidden="true">
                    <ellipse className={s.r4} cx="80" cy="22" rx="78" ry="20" />
                    <ellipse className={s.r1} cx="80" cy="22" rx="64" ry="15" />
                    <ellipse className={s.r2} cx="80" cy="22" rx="46" ry="10.5" />
                    <ellipse className={s.r3} cx="80" cy="22" rx="26" ry="6" />
                    <ellipse className={s.r5} cx="80" cy="22" rx="7" ry="1.6" />
                  </svg>
                </div>
                {i < STEPS.length - 1 && (
                  <span className={cn(s.arrow, i <= current && s.arrowOn)} aria-hidden="true">
                    <ChevronsRight className="size-6" strokeWidth={3} />
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </HoloPanel>
  );
}

/** The decision log of the order: who did what and when (it used to sit inside the workflow panel). */
export function OrderHistory({ order }: { order: FtOrderView }) {
  return (
    <HoloPanel id="history" icon={<History className="size-6" />} title="Батлах түүх">
      <ul className={s.historyList}>
        <li className="text-sm text-text-muted">
          {formatDateTime(order.createdAt)} — <span className="text-text">{order.createdBy.name}</span> захиалга үүсгэсэн
        </li>
        {order.selection?.at && (
          <li className="text-sm text-text-muted">
            {formatDateTime(order.selection.at)} — <span className="text-text">{order.selection.by ?? "MANAGER"}</span> эцсийн нийлүүлэгчийг бүртгэсэн
          </li>
        )}
        {order.decisions.map((d) => (
          <li key={d.id} className="flex items-start gap-2 text-sm">
            {d.action === "APPROVE" ? <Check className="mt-0.5 size-4 shrink-0 text-success" /> : <Undo2 className="mt-0.5 size-4 shrink-0 text-danger" />}
            <div>
              <span className="text-text-muted">{formatDateTime(d.createdAt)} — </span>
              <span className="font-medium text-text">{d.decidedBy.name}</span>
              <span className="text-text-muted"> ({d.decidedBy.title ?? FT_STAGE_LABEL[d.stage]}) · {FT_STAGE_LABEL[d.stage]}: </span>
              <span className={d.action === "APPROVE" ? "text-success" : "text-danger"}>{d.action === "APPROVE" ? "баталсан" : "буцаасан"}</span>
              {d.reason && <p className="mt-0.5 whitespace-pre-wrap rounded-md bg-danger/10 px-2 py-1 text-text">{d.reason}</p>}
            </div>
          </li>
        ))}
        {order.approvedAt && <li className="text-sm text-success">{formatDateTime(order.approvedAt)} — эцэслэн батлагдаж, Санхүүгийн хэлтэст шилжсэн</li>}
      </ul>
    </HoloPanel>
  );
}
