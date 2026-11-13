"use client";

import { CheckCircle2, CloudOff, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// 1С санхүүгийн самбарын шинэчлэл (сервер талын дүрэм: lib/onec/refresh.ts). Энд зөвхөн дуудаж, төлөвийг харуулна.
// Хуудас эхлээд Postgres-ийн өгөгдлөөр шууд нээгдэнэ; шинэчлэл ар талд явж, дуусмагц хуудас өөрөө дахин ачаалагдана.

const TZ = "Asia/Ulaanbaatar";
const POLL_MS = 3000;
const POLL_MAX_MS = 6 * 60_000;
// GitHub Actions: дараалалд орж, эхэлж (~1 мин), татаж (1-3 мин) дуусна
const POLL_ACTIONS_MAX_MS = 10 * 60_000;
const DONE_VISIBLE_MS = 6000;

/** "14:05" (Улаанбаатарын цагаар) */
export function formatHm(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export const currentMonthUb = (): string => new Date().toLocaleString("sv-SE", { timeZone: TZ }).slice(0, 7);

async function postRefresh<T>(body: unknown): Promise<T> {
  const res = await fetch("/api/dashboard/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Алдаа ${res.status}`);
  return json as T;
}

// ---- агуулах: хуудас нээгдэх бүрд ----

export type StockPhase = "idle" | "refreshing" | "done" | "offline" | "recent";

/**
 * Хуудас нээгдэхэд (зөвхөн одоогийн сар) 1С-ээс агуулахын үлдэгдлийг татна (сервер 1 минутад ганц удаа). Амжилттай бол onRefreshed().
 * Өнгөрсөн сарыг автоматаар татахгүй: тэр сарын эцсийн үлдэгдлийг зөвхөн админ товчоор татна (сервер мөн шалгана).
 * `refresh()` нь «Шинэчлэх» товч: сервер мөн ижил 1 минутын хязгаарыг дагана.
 */
export function useStockRefresh(onRefreshed: () => void, month: string = currentMonthUb()) {
  const [phase, setPhase] = useState<StockPhase>("idle");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const cb = useRef(onRefreshed);
  cb.current = onRefreshed;
  const alive = useRef(true);

  const run = useCallback(async (manual: boolean) => {
    setPhase("refreshing");
    try {
      const r = await postRefresh<{ status: "refreshed" | "recent" | "busy" | "failed"; lastSyncedAt: string | null; retryAfterSeconds?: number }>({ kind: "stock", month });
      if (!alive.current) return;
      setLastSyncedAt(r.lastSyncedAt);
      if (r.status === "refreshed") {
        cb.current();
        setPhase("done");
        setTimeout(() => alive.current && setPhase((p) => (p === "done" ? "idle" : p)), DONE_VISIBLE_MS);
      } else if (r.status === "failed") {
        setPhase("offline");
      } else {
        if (r.retryAfterSeconds) setRetryAt(Date.now() + r.retryAfterSeconds * 1000);
        setPhase(manual && r.status === "recent" ? "recent" : "idle"); // автомат: чимээгүй; товчоор: хэзээ дахин боломжтойг хэлнэ
      }
    } catch {
      if (alive.current) setPhase(manual ? "offline" : "idle"); // сервер, сүлжээний алдаа: Postgres-ийн өгөгдөл хэвээр харагдана
    }
  }, [month]);

  useEffect(() => {
    alive.current = true;
    setPhase("idle");
    setRetryAt(null);
    if (month === currentMonthUb()) void run(false);
    return () => {
      alive.current = false;
    };
  }, [run, month]);

  return { phase, lastSyncedAt, retryAt, refresh: () => run(true) };
}

export function StockRefreshNote({ phase, lastSyncedAt }: { phase: StockPhase; lastSyncedAt: string | null }) {
  if (phase === "offline") {
    return (
      <Note tone="warning" icon={<CloudOff className="size-4" />}>
        1С холбогдохгүй, сүүлийн өгөгдөл: {formatHm(lastSyncedAt)}
      </Note>
    );
  }
  if (phase === "refreshing") {
    return (
      <Note tone="muted" icon={<Loader2 className="size-4 animate-spin" />}>
        1С-тэй тулгаж байна…
      </Note>
    );
  }
  if (phase === "done") {
    return (
      <Note tone="success" icon={<CheckCircle2 className="size-4" />}>
        Шинэчлэгдлээ
      </Note>
    );
  }
  if (phase === "recent") {
    return (
      <Note tone="muted" icon={<RefreshCw className="size-4" />}>
        Өгөгдөл шинэхэн байна. 1С-ийг минутад нэгээс илүү удаа дуудахгүй.
      </Note>
    );
  }
  return null;
}

// ---- борлуулалт, мөнгөн хөрөнгө: ар талд ----

export type MonthKind = "sales" | "pl" | "cash";
export type MonthPhase = "idle" | "starting" | "running" | "done" | "failed" | "recent" | "error" | "unavailable" | "slow";

interface SyncStatus {
  running: boolean;
  month: { kinds: Record<string, { at: string; ok: boolean } | null>; lastSyncedAt: string | null };
}

type RefreshResponse =
  | { status: "started" | "recent" | "busy"; retryAfterSeconds?: number; via?: "actions" }
  /** Vercel: GitHub Actions-д өгсөн (lib/onec/refresh-dispatch.ts) */
  | { status: "dispatched"; dispatchedAt: string }
  | { status: "scheduled" | "unavailable" };

/**
 * Энэ сар хуучирсан (5 минутаас илүү) бол ар талд татаж эхэлнэ; хэрэглэгч хүлээхгүй. Дуусмагц onDone() (хуудас дахин ачаална).
 * kind "receivables": Авлагын агшин зургийг (Balance 10-110 сек) ар талд шинэчилнэ; дууссаныг авлагын төлвөөр шалгана.
 * Vercel дээр хүнд татаалт GitHub Actions дээр ажиллана: сервер «dispatched» гэж хариулж, дуусахыг onec_sync_log-ийн шинэ бичлэгээр
 * (since-ээс хойших) мэднэ. Автоматаар (хуудас нээгдэхэд) дуудахгүй: одоогийн сарыг workflow-ийн 15 минутын хуваарь шинэчилнэ.
 * `refresh()` нь «Одоо шинэчлэх» товч: сервер мөн адил 5 минутын хязгаарыг дагана.
 */
export function useMonthRefresh(month: string, onDone: () => void, kind: "month" | "receivables" = "month", kinds?: readonly MonthKind[]) {
  const [phase, setPhase] = useState<MonthPhase>("idle");
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const cb = useRef(onDone);
  cb.current = onDone;
  const alive = useRef(true);
  const polling = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const poll = useCallback(async (m: string, since?: number) => {
    if (polling.current) return;
    polling.current = true;
    const started = Date.now();
    let seen: string | null | undefined;
    try {
      while (alive.current && Date.now() - started < (since === undefined ? POLL_MAX_MS : POLL_ACTIONS_MAX_MS)) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (!alive.current) return;
        let failed: boolean;
        if (kind === "receivables") {
          const res = await fetch(`/api/dashboard/receivables?month=${m}`).catch(() => null);
          if (!res?.ok) continue;
          const s = (await res.json()) as { refreshing: boolean; lastAttemptOk: boolean | null; lastAttemptAt: string | null; lastSyncedAt: string | null };
          if (since !== undefined ? !s.lastAttemptAt || Date.parse(s.lastAttemptAt) <= since : s.refreshing) {
            // Данс бүр дуусах бүрд хуудас шинэчлэгдэнэ: 1201 (~10 сек) ирмэгц харагдана, удаан НӨАТ-ын данс дараа нь
            if (seen !== undefined && s.lastSyncedAt !== seen) cb.current();
            seen = s.lastSyncedAt;
            continue;
          }
          failed = s.lastAttemptOk === false;
        } else {
          const res = await fetch(`/api/dashboard/sync-status?month=${m}`).catch(() => null);
          if (!res?.ok) continue;
          const s = (await res.json()) as SyncStatus;
          const mine = Object.entries(s.month.kinds).filter(([name]) => !kinds || kinds.includes(name as MonthKind));
          if (since !== undefined ? mine.some(([, k]) => !k || Date.parse(k.at) <= since) : s.running) continue; // Actions: хүссэн төрөл бүр since-ээс хойш бүртгэгдтэл
          failed = mine.some(([, k]) => !k || !k.ok);
        }
        cb.current(); // хуудсыг шинэ өгөгдлөөр дахин ачаална
        setPhase(failed ? "failed" : "done");
        if (!failed) setTimeout(() => alive.current && setPhase((p) => (p === "done" ? "idle" : p)), DONE_VISIBLE_MS);
        return;
      }
      if (alive.current) setPhase(since === undefined ? "error" : "slow");
    } finally {
      polling.current = false;
    }
  }, [kind, kinds]);

  const run = useCallback(
    async (manual: boolean) => {
      setPhase("starting");
      try {
        const r = await postRefresh<RefreshResponse>({ kind, month, ...(kinds ? { kinds } : {}), ...(manual ? {} : { auto: true }) });
        if (!alive.current) return;
        if (r.status === "dispatched") {
          setPhase("running");
          void poll(month, Date.parse(r.dispatchedAt) - 2000); // цагийн бага зөрүү
        } else if (r.status === "scheduled") {
          setPhase("idle"); // Vercel: одоогийн сарыг workflow-ийн хуваарь шинэчилнэ
        } else if (r.status === "unavailable") {
          setPhase(manual ? "unavailable" : "idle");
        } else if (r.status === "started" || r.status === "busy") {
          setPhase("running"); // «busy»: өөр хүн эхлүүлсэн таталт явж байна, дууссаныг мөн хүлээнэ
          void poll(month, "via" in r && r.via === "actions" ? Date.now() - 5 * 60_000 : undefined);
        } else {
          setRetryAt(Date.now() + ("retryAfterSeconds" in r ? r.retryAfterSeconds ?? 0 : 0) * 1000);
          setPhase(manual ? "recent" : "idle"); // автомат: шинэхэн бол чимээгүй; товчоор: хэзээ дахин боломжтойг хэлнэ
        }
      } catch {
        if (alive.current) setPhase(manual ? "error" : "idle");
      }
    },
    [month, poll, kind, kinds]
  );

  // Сүүлийн сарыг л автоматаар шинэчилнэ; өнгөрсөн сар 1С-ээс аль хэдийн татагдсан
  useEffect(() => {
    if (month === currentMonthUb()) void run(false);
  }, [month, run]);

  return { phase, retryAt, busy: phase === "starting" || phase === "running", refresh: () => run(true) };
}

/** «Шинэчлэх» товч: ажиллаж байхад, эсвэл хязгаар (retryAt) дуусаагүй бол идэвхгүй, үлдсэн хугацааг харуулна */
export function RefreshButton({ busy, retryAt, onClick }: { busy: boolean; retryAt: number | null; onClick: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!retryAt || retryAt <= Date.now()) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [retryAt]);
  const waitS = retryAt ? Math.max(0, Math.ceil((retryAt - now) / 1000)) : 0;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || waitS > 0}
      className="focus-ring inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-bg-elevated px-3 text-sm text-text transition-colors hover:bg-bg-elevated/70 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <RefreshCw className={cn("size-4", busy && "animate-spin")} />
      Шинэчлэх{waitS > 0 ? ` (${Math.floor(waitS / 60)}:${String(waitS % 60).padStart(2, "0")})` : ""}
    </button>
  );
}

export function MonthRefreshNote({ phase, retryAt }: { phase: MonthPhase; retryAt: number | null }) {
  if (phase === "running" || phase === "starting") {
    return (
      <Note tone="muted" icon={<Loader2 className="size-4 animate-spin" />}>
        1С-ээс шинэчилж байна… Одоогийн өгөгдлөөр харуулж байна.
      </Note>
    );
  }
  if (phase === "done") {
    return (
      <Note tone="success" icon={<CheckCircle2 className="size-4" />}>
        Шинэчлэгдлээ
      </Note>
    );
  }
  if (phase === "failed") {
    return (
      <Note tone="warning" icon={<CloudOff className="size-4" />}>
        1С-ээс зарим өгөгдлийг татаж чадсангүй. Сүүлд хадгалсан өгөгдлийг харуулж байна.
      </Note>
    );
  }
  if (phase === "unavailable") {
    return (
      <Note tone="muted" icon={<RefreshCw className="size-4" />}>
        Энэ мэдээлэл 15 минут тутам автоматаар шинэчлэгддэг. Товчоор шинэчлэх боломжгүй байна.
      </Note>
    );
  }
  if (phase === "slow") {
    return (
      <Note tone="warning" icon={<CloudOff className="size-4" />}>
        Татаалт эхэлсэн боловч удаж байна. Дуусмагц хуудсыг дахин нээхэд шинэ өгөгдөл харагдана.
      </Note>
    );
  }
  if (phase === "error") {
    return (
      <Note tone="warning" icon={<CloudOff className="size-4" />}>
        Шинэчлэлт эхлүүлж чадсангүй. Сүүлд хадгалсан өгөгдлийг харуулж байна.
      </Note>
    );
  }
  if (phase === "recent" && retryAt) {
    return (
      <Note tone="muted" icon={<RefreshCw className="size-4" />}>
        Өгөгдөл шинэхэн байна. 1С-ийг 5 минутад нэгээс илүү удаа дуудахгүй.
      </Note>
    );
  }
  return null;
}

function Note({ tone, icon, children }: { tone: "muted" | "success" | "warning"; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm",
        tone === "success" && "border-success/30 bg-success/10 text-success",
        tone === "warning" && "border-warning/30 bg-warning/10 text-warning",
        tone === "muted" && "border-border bg-bg-elevated/50 text-text-muted"
      )}
    >
      {icon}
      {children}
    </div>
  );
}
