import Link from "next/link";
import { Clock, FileText, Pencil, Zap } from "lucide-react";
import { CURRENT, splitLabel, STEPS } from "../ApprovalTimeline";
import type { FtOrderView } from "@/lib/foreign-trade";
import { cn, formatDateTime } from "@/lib/utils";
import { HoloPanel } from "./HoloPanel";
import s from "./holo.module.css";

const R = 54;
const C = 2 * Math.PI * R;

/**
 * Right-hand summary: only facts the order already carries (number, dates, creator, current step, state) and the position
 * along its stages. "n/6" is the number of the stage the order is in now (a finished order shows 6/6); it is not the count
 * of stages already approved.
 */
export function OrderSummary({ order }: { order: FtOrderView }) {
  const current = CURRENT[order.status];
  const approved = order.status === "APPROVED";
  const returned = order.status === "RETURNED_TO_BOSS" || order.status === "RETURNED_TO_MANAGER";
  const stepNo = Math.min(current + 1, STEPS.length);
  const pct = Math.round((stepNo / STEPS.length) * 100);
  const stroke = approved ? "#10b981" : returned ? "#f87171" : "#f59e0b";
  const [main, sub] = splitLabel(approved ? "Дууссан" : STEPS[current]);
  return (
    <HoloPanel icon={<FileText className="size-6" />} iconTone="cyan" title="Хүсэлтийн тойм" tone="amber" bodyClassName="!px-4">
      <dl className={s.dl}>
        <div>
          <dt>Дугаар</dt>
          <dd className={s.nowrap}>{order.orderNumber}</dd>
        </div>
        <div>
          <dt>Төрөл</dt>
          <dd className={s.nowrap}>Гадаад худалдаа</dd>
        </div>
        <div>
          <dt>Үүсгэсэн</dt>
          <dd className={s.nowrap}>{formatDateTime(order.createdAt)}</dd>
        </div>
        <div>
          <dt>Үүсгэсэн хэрэглэгч</dt>
          <dd className="truncate">{order.createdBy.title ?? order.createdBy.name}</dd>
        </div>
        <div>
          <dt>Одоогийн алхам</dt>
          <dd className={s.ddAmber}>
            {main}
            {sub && <span className={s.subLine}>{sub}</span>}
          </dd>
        </div>
        <div>
          <dt>Төлөв</dt>
          <dd>
            <span className={cn(s.statePill, approved && s.statePillGreen, returned && s.statePillRed)}>
              <Clock className="size-3.5" />
              {approved ? "Батлагдсан" : returned ? "Буцсан" : "Хүлээгдэж байна"}
            </span>
          </dd>
        </div>
      </dl>
      <div className={s.progress} role="img" aria-label={`${stepNo}-р алхам, нийт ${STEPS.length}`}>
        <svg viewBox="0 0 140 140" aria-hidden="true">
          <circle cx="70" cy="70" r="64" fill="none" stroke="rgb(34 211 238 / 0.35)" strokeWidth="1" strokeDasharray="2 5" />
          <circle cx="70" cy="70" r={R} fill="none" stroke="rgb(34 211 238 / 0.16)" strokeWidth="13" />
          <circle cx="70" cy="70" r={R} fill="none" stroke={stroke} strokeWidth="13" strokeLinecap="round" strokeDasharray={`${(C * pct) / 100} ${C}`} style={{ filter: `drop-shadow(0 0 6px ${stroke})` }} />
        </svg>
        <div className={s.progressText}>
          <div className="text-xs text-text-muted">Үйл явц</div>
          <div className="text-xl font-bold text-white">
            {stepNo}/{STEPS.length} <span className="text-sm font-semibold">алхам</span>
          </div>
          <div className="text-xs text-text-muted">({pct}%)</div>
        </div>
      </div>
    </HoloPanel>
  );
}

/** Quick actions: only those the application already offers to this viewer (editing a draft / returned order). */
export function QuickActions({ order }: { order: FtOrderView }) {
  if (!order.access.editOrder) return null;
  return (
    <HoloPanel icon={<Zap className="size-6" />} title="Шуурхай үйлдэл" bodyClassName="!px-4">
      <div className={s.quick}>
        <Link href={`/foreign-trade/${order.id}/edit`} className={cn(s.quickBtn, "focus-ring")}>
          <Pencil className="size-4" /> Засах
        </Link>
      </div>
    </HoloPanel>
  );
}
