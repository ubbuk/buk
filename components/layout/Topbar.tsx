"use client";

import { Bell, Search } from "lucide-react";
import { usePathname } from "next/navigation";

const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "Хяналтын самбар",
  "/requests": "Миний захиалгууд",
  "/requests/new": "Шинэ захиалга",
  "/approvals": "Батлах хүсэлтүүд",
  "/warehouse": "Агуулахын шалгалт",
  "/procurement": "Худалдан авалт",
  "/archive": "Захиалгын архив",
  "/reports": "Тайлан",
  "/settings": "Тохиргоо",
};

export function Topbar() {
  const pathname = usePathname() ?? "";
  const title = PAGE_TITLES[pathname] ?? "Худалдан авалтын систем";

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

        <button className="focus-ring relative flex size-9 items-center justify-center rounded-lg border border-border bg-bg-surface text-text-muted hover:text-text">
          <Bell className="size-4" />
          <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-danger" />
        </button>

        <div className="flex items-center gap-2.5 rounded-lg border border-border bg-bg-surface py-1 pl-1 pr-3">
          <div className="flex size-7 items-center justify-center rounded-md bg-accent/15 text-xs font-semibold text-accent">
            БТ
          </div>
          <div className="hidden text-left leading-tight md:block">
            <p className="text-xs font-medium text-text">Б.Төмөрбаатар</p>
            <p className="text-[11px] text-text-muted">Цех хэсгийн дарга</p>
          </div>
        </div>
      </div>
    </header>
  );
}
