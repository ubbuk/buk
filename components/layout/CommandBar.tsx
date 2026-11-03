"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, Bell, Boxes, Factory, LayoutGrid, ListChecks, LogOut, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import { USER_ROLE_LABEL, type RequestStatus } from "@/lib/types";
import { PAGE_TITLES, resolveNavItems } from "@/lib/nav";
import { useRequestStore } from "@/lib/store";
import { cn, formatDateTime } from "@/lib/utils";
import BlurText from "@/components/ui/BlurText";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

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

  const badgeCounts: Record<string, number> = {
    approvals: requests.filter((r) => r.approvalSteps.some((s) => s.status === "PENDING" && s.type !== "WAREHOUSE_CHECK")).length,
    accounting: requests.filter((r) => r.status === "PENDING_ACCOUNTING").length,
  };

  const navItems = resolveNavItems(user?.role);

  const [launcherOpen, setLauncherOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const launcherRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);

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
      if (res.ok) setNotifications(await res.json());
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
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-bg-sidebar/90 px-4 backdrop-blur sm:px-6">
      <Link href="/dashboard" className="flex shrink-0 items-center gap-2.5">
        <div className="flex size-9 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <Factory className="size-5" />
        </div>
        <span className="hidden text-sm font-semibold text-text lg:inline">УБ БҮК ХК</span>
      </Link>

      {pathname !== "/dashboard" && (
        <button
          onClick={() => router.back()}
          className="focus-ring flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-bg-surface px-3 text-xs font-medium text-text-muted transition-colors hover:text-text"
        >
          <ArrowLeft className="size-4" />
          <span className="hidden sm:inline">Буцах</span>
        </button>
      )}

      <div ref={launcherRef} className="relative shrink-0">
        <button
          onClick={() => setLauncherOpen((o) => !o)}
          className={cn(
            "focus-ring relative flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-medium transition-colors",
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
              className="absolute left-0 z-20 mt-2 w-72 overflow-hidden rounded-xl border border-border bg-bg-surface p-1.5 shadow-elevated"
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
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="mx-1 hidden h-6 w-px bg-border md:block" />
      <div className="hidden md:block">
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

      <div className="ml-auto flex items-center gap-3">
        <div ref={searchRef} className="relative hidden w-64 lg:block">
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
                {searchLoading && !searchResults ? (
                  <p className="px-3 py-6 text-center text-xs text-text-muted">Хайж байна...</p>
                ) : !searchResults || (searchResults.requests.length === 0 && searchResults.materials.length === 0) ? (
                  <p className="px-3 py-6 text-center text-xs text-text-muted">Илэрц олдсонгүй</p>
                ) : (
                  <>
                    {searchResults.requests.length > 0 && (
                      <div className="p-1.5">
                        <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                          Захиалга
                        </p>
                        {searchResults.requests.map((r) => (
                          <button
                            key={r.id}
                            onClick={() => goToSearchRequest(r.id)}
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
                    {searchResults.materials.length > 0 && (
                      <div className="border-t border-border p-1.5">
                        <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                          Материал
                        </p>
                        {searchResults.materials.map((m) => (
                          <button
                            key={m.id}
                            onClick={() => goToSearchMaterial(m.id)}
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
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <ThemeToggle />

        <div ref={notifRef} className="relative">
          <button
            onClick={() => setNotifOpen((o) => !o)}
            className="focus-ring relative flex size-9 items-center justify-center rounded-lg border border-border bg-bg-surface text-text-muted hover:text-text"
          >
            <Bell className="size-4" />
            {unreadCount > 0 && (
              <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-danger text-[9px] font-semibold text-white">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className="absolute right-0 z-20 mt-2 w-80 overflow-hidden rounded-xl border border-border bg-bg-surface shadow-elevated">
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
          <div className="flex items-center gap-2.5 rounded-lg border border-border bg-bg-surface py-1 pl-1 pr-2">
            <div className="flex size-7 items-center justify-center rounded-md bg-accent/15 text-xs font-semibold text-accent">
              {initials(user.name ?? "?")}
            </div>
            <div className="hidden text-left leading-tight md:block">
              <p className="text-xs font-medium text-text">{user.name}</p>
              <p className="text-[11px] text-text-muted">{USER_ROLE_LABEL[user.role] ?? user.role}</p>
            </div>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              title="Гарах"
              className="focus-ring ml-1 flex size-7 items-center justify-center rounded-md text-text-muted hover:bg-bg-elevated hover:text-danger"
            >
              <LogOut className="size-3.5" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
