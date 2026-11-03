"use client";

import { Bell, LogOut, Search } from "lucide-react";
import { signOut, useSession } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cn, formatDateTime } from "@/lib/utils";
import { USER_ROLE_LABEL } from "@/lib/types";

const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Хяналтын самбар",
  "/requests": "Миний захиалгууд",
  "/requests/new": "Шинэ захиалга",
  "/approvals": "Батлах хүсэлтүүд",
  "/warehouse": "Агуулахын шалгалт",
  "/warehouses": "Агуулахын жагсаалт",
  "/accounting": "Санхүүгийн бүртгэл",
  "/archive": "Захиалгын архив",
  "/reports": "Тайлан",
  "/settings": "Тохиргоо",
  "/admin": "Хэрэглэгч, эрх",
};

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

export function Topbar() {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const title = PAGE_TITLES[pathname] ?? "Худалдан авалтын систем";
  const { data: session } = useSession();
  const user = session?.user;

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
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
    setOpen(false);
    if (n.relatedRequestId) router.push(`/requests/${n.relatedRequestId}`);
  }

  async function markAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    fetch("/api/notifications/read-all", { method: "POST" }).catch(() => {});
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-border bg-bg/80 px-6 backdrop-blur">
      <h1 className="text-base font-semibold text-text">{title}</h1>

      <div className="ml-auto flex items-center gap-3">
        <div className="relative hidden w-64 sm:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <input
            placeholder="Захиалга, материал хайх..."
            className="focus-ring h-9 w-full rounded-lg border border-border bg-bg-surface pl-9 pr-3 text-sm text-text placeholder:text-text-muted"
          />
        </div>

        <div ref={containerRef} className="relative">
          <button
            onClick={() => setOpen((o) => !o)}
            className="focus-ring relative flex size-9 items-center justify-center rounded-lg border border-border bg-bg-surface text-text-muted hover:text-text"
          >
            <Bell className="size-4" />
            {unreadCount > 0 && (
              <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-danger text-[9px] font-semibold text-white">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>

          {open && (
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
