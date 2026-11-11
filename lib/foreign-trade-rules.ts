// Pure rules of the foreign trade module (no database, no server imports): the status machine, who may see and do what,
// and the supplier comparison. The server (lib/foreign-trade.ts) enforces them; the pages only use them to decide which
// buttons to show, never as the authority.

export type FtStatus =
  | "DRAFT"
  | "PENDING_MANAGER"
  | "PENDING_TECHNICAL"
  | "RETURNED_TO_MANAGER"
  | "PENDING_FINANCE"
  | "PENDING_EXECUTIVE"
  | "RETURNED_TO_BOSS"
  | "APPROVED";

export type FtStage = "TECHNICAL" | "FINANCE" | "EXECUTIVE";

export const FT_STATUS_LABEL: Record<FtStatus, string> = {
  DRAFT: "Ноорог",
  PENDING_MANAGER: "Үнийн судалгаа (MANAGER)",
  PENDING_TECHNICAL: "Техникийн хяналт",
  RETURNED_TO_MANAGER: "MANAGER руу буцсан",
  PENDING_FINANCE: "Санхүүгийн хяналт",
  PENDING_EXECUTIVE: "Гүйцэтгэх захирлын баталгаа",
  RETURNED_TO_BOSS: "Цехийн дарга руу буцсан",
  APPROVED: "Батлагдсан — Санхүүгийн хэлтэст шилжсэн",
};

export const FT_STATUS_TONE: Record<FtStatus, string> = {
  DRAFT: "bg-text-muted/15 text-text-muted",
  PENDING_MANAGER: "bg-accent/15 text-accent",
  PENDING_TECHNICAL: "bg-warning/15 text-warning",
  RETURNED_TO_MANAGER: "bg-danger/15 text-danger",
  PENDING_FINANCE: "bg-warning/15 text-warning",
  PENDING_EXECUTIVE: "bg-warning/15 text-warning",
  RETURNED_TO_BOSS: "bg-danger/15 text-danger",
  APPROVED: "bg-success/15 text-success",
};

export const FT_STAGE_LABEL: Record<FtStage, string> = {
  TECHNICAL: "Техникийн хяналт",
  FINANCE: "Санхүү хариуцсан захирал",
  EXECUTIVE: "Гүйцэтгэх захирал",
};

/** ApprovalPosition values that may decide each stage. Technical review is an OR over two positions. */
export const FT_STAGE_POSITIONS: Record<FtStage, readonly string[]> = {
  TECHNICAL: ["OPERATIONS_DIRECTOR", "ENGINEERING_CHIEF"],
  FINANCE: ["FINANCE_DIRECTOR"],
  EXECUTIVE: ["EXECUTIVE_DIRECTOR"],
};

export const FT_STATUS_STAGE: Partial<Record<FtStatus, FtStage>> = {
  PENDING_TECHNICAL: "TECHNICAL",
  PENDING_FINANCE: "FINANCE",
  PENDING_EXECUTIVE: "EXECUTIVE",
};

/** Statuses in which the MANAGER works on the order (price research, sharing, selection). */
export const FT_MANAGER_STATUSES: readonly FtStatus[] = ["PENDING_MANAGER", "RETURNED_TO_MANAGER"];
/** Statuses in which the BOSS who created the order may edit and (re)submit it. */
export const FT_BOSS_STATUSES: readonly FtStatus[] = ["DRAFT", "RETURNED_TO_BOSS"];

export interface FtAccessFacts {
  createdById: string;
  status: FtStatus;
  sharedWithBoss: boolean;
  sharedWithTechnical: boolean;
  /** a technical approval exists (any cycle): the finance director may see the order from then on */
  passedTechnical: boolean;
  /** a finance approval exists (any cycle): the executive director may see the order from then on */
  passedFinance: boolean;
}

export interface FtActor {
  id: string;
  role: string;
  /** ApprovalPositions the user holds right now */
  positions: readonly string[];
}

export interface FtAccess {
  view: boolean;
  isCreator: boolean;
  isManager: boolean;
  isAdmin: boolean;
  /** quotes (the price research) and the files attached to them */
  seeQuotes: boolean;
  /** the discussion thread: reading */
  readDiscussion: boolean;
  /** the discussion thread: writing (BOSS, MANAGER, the two technical positions) */
  postMessage: boolean;
  editOrder: boolean;
  submitOrder: boolean;
  manageQuotes: boolean;
  /** the stage this actor may decide right now, if any */
  decisionStage: FtStage | null;
}

export const ftHolds = (actor: FtActor, stage: FtStage) => FT_STAGE_POSITIONS[stage].some((p) => actor.positions.includes(p));

export function ftAccess(facts: FtAccessFacts, actor: FtActor): FtAccess {
  const isAdmin = actor.role === "ADMIN";
  const isCreator = actor.role === "BOSS" && facts.createdById === actor.id;
  const isManager = actor.role === "MANAGER";
  const technical = ftHolds(actor, "TECHNICAL");
  const finance = ftHolds(actor, "FINANCE");
  const executive = ftHolds(actor, "EXECUTIVE");
  const accounting = actor.role === "CHIEF_ACCOUNTANT" && facts.status === "APPROVED";

  const seesAsTechnical = technical && facts.sharedWithTechnical;
  const seesAsFinance = finance && facts.passedTechnical;
  const seesAsExecutive = executive && facts.passedFinance;
  const managerView = isManager && facts.status !== "DRAFT";

  const view = isAdmin || isCreator || managerView || seesAsTechnical || seesAsFinance || seesAsExecutive || accounting;
  const seeQuotes =
    isAdmin || managerView || seesAsTechnical || seesAsFinance || seesAsExecutive || accounting || (isCreator && facts.sharedWithBoss);
  const participant = (isCreator || managerView || seesAsTechnical) && facts.status !== "DRAFT";

  const stage = FT_STATUS_STAGE[facts.status] ?? null;
  const decisionStage = stage && ftHolds(actor, stage) ? stage : null;

  return {
    view,
    isCreator,
    isManager: managerView,
    isAdmin,
    seeQuotes,
    readDiscussion: participant || isAdmin || seesAsFinance || seesAsExecutive,
    postMessage: participant,
    editOrder: isCreator && FT_BOSS_STATUSES.includes(facts.status),
    submitOrder: isCreator && FT_BOSS_STATUSES.includes(facts.status),
    manageQuotes: managerView && FT_MANAGER_STATUSES.includes(facts.status),
    decisionStage,
  };
}

// --- supplier comparison ----------------------------------------------------

export interface FtQuoteLike {
  id: string;
  currency: string;
  price: number;
  shippingCost: number;
  leadTimeDays: number | null;
}

export interface FtQuoteMetrics {
  total: number;
  /** cheapest total among the quotes quoted in the same currency (only when more than one quote shares it) */
  cheapestInCurrency: boolean;
  fastest: boolean;
}

/**
 * Per-quote metrics for the comparison table. No exchange rate is applied: totals are only compared within one
 * currency, so a quote in another currency is never ranked against them.
 */
export function compareQuotes<T extends FtQuoteLike>(quotes: readonly T[]): Map<string, FtQuoteMetrics> {
  const totals = quotes.map((q) => ({ q, total: q.price + q.shippingCost }));
  const bestByCurrency = new Map<string, number>();
  const countByCurrency = new Map<string, number>();
  for (const { q, total } of totals) {
    bestByCurrency.set(q.currency, Math.min(bestByCurrency.get(q.currency) ?? Infinity, total));
    countByCurrency.set(q.currency, (countByCurrency.get(q.currency) ?? 0) + 1);
  }
  const leadTimes = quotes.map((q) => q.leadTimeDays).filter((d): d is number => d != null);
  const fastestDays = leadTimes.length > 1 ? Math.min(...leadTimes) : null;

  const out = new Map<string, FtQuoteMetrics>();
  for (const { q, total } of totals) {
    out.set(q.id, {
      total,
      cheapestInCurrency: (countByCurrency.get(q.currency) ?? 0) > 1 && total === bestByCurrency.get(q.currency),
      fastest: fastestDays != null && q.leadTimeDays === fastestDays,
    });
  }
  return out;
}

export const FT_CURRENCIES = ["USD", "EUR", "CNY", "RUB", "KRW", "JPY", "MNT", "GBP", "TRY"] as const;
