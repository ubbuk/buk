import type { ProcurementStage } from "@/lib/monitoring/procurement-calc";
import type { TrackKind } from "@/lib/monitoring/procurement-types";
import { formatNumber } from "@/lib/utils";

// Labels and tones shared by the procurement monitoring components.
export const STAGE_LABEL: Record<ProcurementStage, string> = {
  AWAITING_CLASSIFICATION: "Ангилал хүлээж буй",
  IN_PROCUREMENT: "Худалдан авалт явагдаж буй",
  READY_TO_COMPLETE: "Бүгд авсан — дуусгахыг хүлээж буй",
  AWAITING_ACCOUNTING: "Нягтлан бүртгэл хүлээж буй",
  PROCUREMENT_COMPLETED: "Худалдан авалт дууссан",
};
export const STAGE_TONE: Record<ProcurementStage, string> = {
  AWAITING_CLASSIFICATION: "bg-warning/15 text-warning",
  IN_PROCUREMENT: "bg-accent/15 text-accent",
  READY_TO_COMPLETE: "bg-success/15 text-success",
  AWAITING_ACCOUNTING: "bg-bg-elevated text-text-muted",
  PROCUREMENT_COMPLETED: "bg-success/15 text-success",
};
export const KIND_LABEL: Record<TrackKind, string> = { DOMESTIC: "Дотоод", INTERNATIONAL: "Олон улс" };
export const KIND_TONE: Record<TrackKind, string> = { DOMESTIC: "bg-accent/15 text-accent", INTERNATIONAL: "bg-warning/15 text-warning" };
export const ITEM_STATUS_LABEL = { NOT_REQUIRED: "Агуулахаас бүрэн", NOT_STARTED: "Эхлээгүй", PARTIAL: "Хэсэгчлэн", COMPLETE: "Бүрэн" } as const;
export const ITEM_STATUS_TONE = {
  NOT_REQUIRED: "bg-bg-elevated text-text-muted",
  NOT_STARTED: "bg-bg-elevated text-text-muted",
  PARTIAL: "bg-warning/15 text-warning",
  COMPLETE: "bg-success/15 text-success",
} as const;

export const qty = (n: number) => formatNumber(n, 3);
