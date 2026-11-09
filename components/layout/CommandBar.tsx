"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Bell, Boxes, Factory, LayoutGrid, ListChecks, LogOut, Search, UserRound, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { USER_ROLE_LABEL, type RequestStatus } from "@/lib/types";
import { PAGE_TITLES, resolveNavItems } from "@/lib/nav";
import { approvalQueueFor } from "@/lib/approval-queue";
import { useRequestStore } from "@/lib/store";
import { useProcurementBadge } from "@/lib/use-procurement-badge";
import { cn, formatDateTime } from "@/lib/utils";
import BlurText from "@/components/ui/BlurText";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { useToast } from "@/components/ui/Toast";

interface SearchRequestResult {
  id: string;
  requestNumber: string;
  status: RequestStatus;
  department: string;
  requestedBy: string;
}
interface SearchMaterialResult {
  id: string;
  name: string;
  code: string;
  unit: string;
  category: string | null;
}
interface SearchResults {
  requests: SearchRequestResult[];
  materials: SearchMaterialResult[];
}

const SEARCH_MIN_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 250;

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  relatedRequestId: string | null;
  isRead: boolean;
  createdAt: string;
}

function SearchResultsBody({
  loading,
  results,
  onRequest,
  onMaterial,
}: {
  loading: boolean;
  results: SearchResults | null;
  onRequest: (id: string) => void;
  onMaterial: (id: string) => void;
}) {
  return (
    <>
      {loading && !results ? (
        <p className="px-3 py-6 text-center text-xs text-text-muted">Хайж байна...</p>
      ) : !results || (results.requests.length === 0 && results.materials.length === 0) ? (
        <p className="px-3 py-6 text-center text-xs text-text-muted">Илэрц олдсонгүй</p>
      ) : (
        <>
          {results.requests.length > 0 && (
            <div className="p-1.5">
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                Захиалга
              </p>
              {results.requests.map((r) => (
                <button
                  key={r.id}
                  onClick={() => onRequest(r.id)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-bg-elevated"
                >
                  <ListChecks className="size-4 shrink-0 text-tech" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-text">
                      №{r.requestNumber} · {r.requestedBy}
                    </span>
                    <span className="block truncate text-[11px] text-text-muted">{r.department}</span>
                  </span>
                  <StatusBadge status={r.status} className="shrink-0" />
                </button>
              ))}
            </div>
          )}
          {results.materials.length > 0 && (
            <div className="border-t border-border p-1.5">
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                Материал
              </p>
              {results.materials.map((m) => (
                <button
                  key={m.id}
                  onClick={() => onMaterial(m.id)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-bg-elevated"
                >
                  <Boxes className="size-4 shrink-0 text-accent" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-text">{m.name}</span>
                    <span className="block truncate text-[11px] text-text-muted">
                      {m.code} · {m.unit}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

function initials(name: string) {
  return name
    .split(/[.\s]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function CommandBar() {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const title = PAGE_TITLES[pathname] ?? "Худалдан авалтын систем";
  const { data: session } = useSession();
  const user = session?.user;
  const requests = useRequestStore((s) => s.requests);
  const procurementBadge = useProcurementBadge(session?.user?.role, session?.user?.id);

  const badgeCounts: Record<string, number> = {
    approvals: approvalQueueFor(requests, session?.user?.id, session?.user?.role).length,
    accounting: requests.filter((r) => r.status === "PENDING_ACCOUNTING").length,
    procurement: procurementBadge,
  };

  const navItems = resolveNavItems(user?.role);

  const [launcherOpen, setLauncherOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const { push } = useToast();
  // Ids already shown/known; null until the first load so existing unread items don't toast on page open.
  const seenNotificationIds = useRef<Set<string> | null>(null);
  const launcherRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  // Phones: the same search (same state, /api/search call and navigation) in a full-width overlay.
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < SEARCH_MIN_LENGTH) {
      setSearchResults(null);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        setSearchResults(res.ok ? await res.json() : { requests: [], materials: [] });
      } catch {
        setSearchResults({ requests: [], materials: [] });
      } finally {
        setSearchLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchQuery]);

  function closeSearch() {
    setMobileSearchOpen(false);
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults(null);
  }

  function goToSearchRequest(id: string) {
    closeSearch();
    router.push(`/requests/${id}`);
  }

  function goToSearchMaterial(id: string) {
    closeSearch();
    router.push(`/requests/new?material=${id}`);
  }

  async function loadNotifications() {
    try {
      const res = await fetch("/api/notifications");
      if (res.ok) {
        const list: NotificationItem[] = await res.json();
        setNotifications(list);
        const seen = seenNotificationIds.current;
        if (seen) {
          for (const n of list) {
            if (!n.isRead && !seen.has(n.id)) push({ kind: "info", title: n.title, description: n.body });
          }
        }
        seenNotificationIds.current = new Set(list.map((n) => n.id));
      }
    } catch {
      // ignore — bell just stays at its last known count
    }
  }

  useEffect(() => {
    if (!user) return;
    loadNotifications();
    window.addEventListener("ubbuk:live-event", loadNotifications);
    return () => window.removeEventListener("ubbuk:live-event", loadNotifications);
  }, [user]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (launcherRef.current && !launcherRef.current.contains(e.target as Node)) setLauncherOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  async function openNotification(n: NotificationItem) {
    if (!n.isRead) {
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)));
      fetch(`/api/notifications/${n.id}/read`, { method: "POST" }).catch(() => {});
    }
    setNotifOpen(false);
    if (n.relatedRequestId) router.push(`/requests/${n.relatedRequestId}`);
  }

  async function markAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    fetch("/api/notifications/read-all", { method: "POST" }).catch(() => {});
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-border bg-bg-sidebar/90 px-3 backdrop-blur max-[359px]:gap-1.5 max-[359px]:px-2 sm:gap-3 sm:px-6">
      <Link href="/dashboard" className="hidden shrink-0 items-center gap-2.5 min-[400px]:flex">
        <div className="flex size-9 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <Factory className="size-5" />
        </div>
        <span className="hidden text-sm font-semibold text-text xl:inline">УБ БҮК ХК</span>
      </Link>

      {pathname !== "/dashboard" && (
        <button
          onClick={() => router.back()}
          aria-label="Буцах"
          className="focus-ring flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-bg-surface px-3 text-xs sm:h-9 sm:min-w-0 font-medium text-text-muted transition-colors hover:text-text"
        >
          <ArrowLeft className="size-4" />
          <span className="hidden sm:inline">Буцах</span>
        </button>
      )}

      <div ref={launcherRef} className="shrink-0 sm:relative">
        <button
          onClick={() => setLauncherOpen((o) => !o)}
          aria-label="Модулиуд"
          className={cn(
            "focus-ring relative flex h-11 min-w-11 items-center justify-center gap-2 rounded-lg border px-3 text-xs font-medium transition-colors sm:h-9 sm:min-w-0",
            launcherOpen
              ? "border-tech/50 bg-tech/10 text-tech"
              : "border-border bg-bg-surface text-text-muted hover:text-text"
          )}
        >
          <LayoutGrid className="size-4" />
          <span className="hidden sm:inline">Модулиуд</span>
          {!launcherOpen && (badgeCounts.approvals > 0 || badgeCounts.accounting > 0) && (
            <span className="absolute -right-1 -top-1 flex size-2.5 rounded-full bg-tech" />
          )}
        </button>

        <AnimatePresence>
          {launcherOpen && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.14 }}
              className="absolute inset-x-2 top-full z-20 mt-1 max-h-[calc(100dvh-5rem)] overflow-y-auto overflow-x-hidden sm:inset-x-auto sm:left-0 sm:mt-2 sm:w-72 rounded-xl border border-border bg-bg-surface p-1.5 shadow-elevated"
            >
              {navItems.map((item) => {
                const active = pathname === item.href || pathname?.startsWith(item.href + "/");
                const Icon = item.icon;
                const badge = item.badgeKey ? badgeCounts[item.badgeKey] : 0;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setLauncherOpen(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                      active ? "bg-tech/10 text-tech" : "text-text-muted hover:bg-bg-elevated hover:text-text"
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="flex-1 truncate">{item.label}</span>
                    {badge > 0 && (
                      <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                        {badge}
                      </span>
                    )}
                  </Link>
                );
              })}
              {/* Under 381px the header has no room for a seventh 44px control, so the profile link
                  (normally on the user menu) is offered here instead. */}
              <Link
                href="/profile"
                onClick={() => setLauncherOpen(false)}
                className="hidden min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-text-muted transition-colors hover:bg-bg-elevated hover:text-text max-[380px]:flex"
              >
                <UserRound className="size-4 shrink-0" aria-hidden="true" />
                <span className="flex-1 truncate">Миний профайл</span>
              </Link>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="mx-1 hidden h-6 w-px bg-border md:block" />
      <div className="hidden min-w-0 md:block">
        <BlurText
          key={pathname}
          text={title}
          trigger="load"
          effect="focus"
          animateBy="words"
          blur={8}
          distance={16}
          stepDuration={0.3}
          delay={50}
          className="text-sm font-semibold text-text"
        />
      </div>

      <div className="ml-auto flex items-center gap-2 max-[359px]:gap-1.5 sm:gap-3">
        <div ref={searchRef} className="relative hidden w-44 lg:block xl:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <input
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => {
              if (searchQuery.trim().length >= SEARCH_MIN_LENGTH) setSearchOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                closeSearch();
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder="Захиалга, материал хайх..."
            className="focus-ring h-9 w-full rounded-lg border border-border bg-bg-surface pl-9 pr-3 text-sm text-text placeholder:text-text-muted"
          />

          <AnimatePresence>
            {searchOpen && searchQuery.trim().length >= SEARCH_MIN_LENGTH && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.14 }}
                className="absolute right-0 top-full z-20 mt-2 max-h-96 w-96 overflow-y-auto rounded-xl border border-border bg-bg-surface shadow-elevated"
              >
                <SearchResultsBody
                  loading={searchLoading}
                  results={searchResults}
                  onRequest={goToSearchRequest}
                  onMaterial={goToSearchMaterial}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <button
          type="button"
          onClick={() => setMobileSearchOpen(true)}
          aria-label="Хайх"
          className="focus-ring flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-bg-surface text-text-muted hover:text-text lg:hidden"
        >
          <Search className="size-4" />
        </button>

        <ThemeToggle />

        <div ref={notifRef} className="sm:relative">
          <button
            onClick={() => setNotifOpen((o) => !o)}
            aria-label="Мэдэгдэл"
            className="focus-ring relative flex size-11 items-center justify-center rounded-lg border border-border bg-bg-surface text-text-muted hover:text-text sm:size-9"
          >
            <Bell className="size-4" />
            {unreadCount > 0 && (
              <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-danger text-[9px] font-semibold text-white">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className="absolute inset-x-2 top-full z-20 mt-1 max-h-[calc(100dvh-5rem)] overflow-y-auto sm:inset-x-auto sm:right-0 sm:mt-2 sm:w-80 rounded-xl border border-border bg-bg-surface shadow-elevated">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <p className="text-xs font-semibold text-text">Мэдэгдэл</p>
                {unreadCount > 0 && (
                  <button onClick={markAllRead} className="text-[11px] text-accent hover:underline">
                    Бүгдийг уншсан болгох
                  </button>
                )}
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notifications.length === 0 ? (
                  <p className="px-3 py-6 text-center text-xs text-text-muted">Мэдэгдэл алга</p>
                ) : (
                  notifications.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => openNotification(n)}
                      className={cn(
                        "flex w-full flex-col gap-0.5 border-b border-border/60 px-3 py-2.5 text-left last:border-0 hover:bg-bg-elevated",
                        !n.isRead && "bg-accent/5"
                      )}
                    >
                      <span className="text-xs font-medium text-text">{n.title}</span>
                      <span className="text-[11px] text-text-muted">{n.body}</span>
                      <span className="text-[10px] text-text-muted/70">{formatDateTime(n.createdAt)}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {user && (
          <div className="flex items-center gap-2.5 rounded-lg border border-border bg-bg-surface py-1 pl-1 pr-2 max-sm:border-0 max-sm:bg-transparent max-sm:p-0">
            {/* The user menu: name and avatar lead to the signed-in user's own profile. */}
            <Link
              href="/profile"
              title="Миний профайл"
              aria-label="Миний профайл"
              className="focus-ring flex items-center gap-2.5 rounded-md max-sm:size-11 max-sm:justify-center max-sm:border max-sm:border-border max-sm:bg-bg-surface max-[380px]:hidden"
            >
              <div className="flex size-7 items-center justify-center rounded-md bg-accent/15 text-xs font-semibold text-accent max-sm:hidden">
                {initials(user.name ?? "?")}
              </div>
              <UserRound className="hidden size-4 text-text-muted max-sm:block" aria-hidden="true" />
              <div className="hidden text-left leading-tight lg:block">
                <p className="text-xs font-medium text-text">{user.name}</p>
                <p className="text-[11px] text-text-muted">{USER_ROLE_LABEL[user.role] ?? user.role}</p>
              </div>
            </Link>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              title="Гарах"
              aria-label="Гарах"
              className="focus-ring ml-1 flex size-7 max-sm:ml-0 max-sm:size-11 max-sm:border max-sm:border-border max-sm:bg-bg-surface items-center justify-center rounded-md text-text-muted hover:bg-bg-elevated hover:text-danger"
            >
              <LogOut className="size-3.5" />
            </button>
          </div>
        )}
      </div>
      {mobileSearchOpen &&
        createPortal(
          <MobileSearchOverlay
            query={searchQuery}
            onQuery={setSearchQuery}
            onClose={closeSearch}
            loading={searchLoading}
            results={searchResults}
            onRequest={goToSearchRequest}
            onMaterial={goToSearchMaterial}
          />,
          document.body
        )}
    </header>
  );
}

function MobileSearchOverlay({
  query,
  onQuery,
  onClose,
  loading,
  results,
  onRequest,
  onMaterial,
}: {
  query: string;
  onQuery: (q: string) => void;
  onClose: () => void;
  loading: boolean;
  results: SearchResults | null;
  onRequest: (id: string) => void;
  onMaterial: (id: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // The on-screen keyboard shrinks the *visual* viewport (iOS leaves the layout viewport alone),
  // so size the overlay to it to keep the result list above the keyboard.
  const [viewHeight, setViewHeight] = useState<number | null>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => setViewHeight(vv.height);
    sync();
    vv.addEventListener("resize", sync);
    return () => vv.removeEventListener("resize", sync);
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Хайлт"
      className="fixed inset-x-0 top-0 z-[60] flex h-dvh flex-col bg-bg"
      style={{ height: viewHeight ?? undefined, paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            placeholder="Захиалга, материал хайх..."
            className="focus-ring h-11 w-full rounded-lg border border-border bg-bg-surface pl-9 pr-3 text-base text-text placeholder:text-text-muted"
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Хайлтыг хаах"
          className="focus-ring flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-bg-surface text-text-muted hover:text-text"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {query.trim().length < SEARCH_MIN_LENGTH ? (
          <p className="px-3 py-6 text-center text-xs text-text-muted">Дор хаяж {SEARCH_MIN_LENGTH} тэмдэгт бичнэ үү</p>
        ) : (
          <SearchResultsBody loading={loading} results={results} onRequest={onRequest} onMaterial={onMaterial} />
        )}
      </div>
    </div>
  );
}
