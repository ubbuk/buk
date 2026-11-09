"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Settings } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { USER_ROLE_LABEL } from "@/lib/types";
import type { OwnProfile } from "@/lib/profile";
import { cn } from "@/lib/utils";

const DEPARTMENT_TYPE_LABEL = { FACTORY: "Үйлдвэр", OFFICE: "Оффис" } as const;

function initials(name: string) {
  return (
    name
      .split(/[.\s]+/)
      .filter(Boolean)
      .map((part) => part[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-medium text-text">{children}</dd>
    </div>
  );
}

/**
 * My profile. One request, to /api/me/profile, which answers for the signed-in user only; nothing
 * here reads or writes the shared request store, and there is no id in the URL to change.
 */
export default function ProfilePage() {
  const [profile, setProfile] = useState<OwnProfile | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/me/profile", { signal: controller.signal, cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<OwnProfile>) : Promise.reject(new Error(String(res.status)))))
      .then((data) => {
        setProfile(data);
        setState("ready");
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setState("error");
      });
    return () => controller.abort();
  }, []);

  if (state === "loading") {
    return (
      <div className="mx-auto max-w-2xl space-y-4" aria-busy="true">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }
  if (state === "error" || !profile) {
    return <EmptyState title="Профайл ачаалж чадсангүй" description="Хуудсыг дахин ачаалж үзнэ үү" />;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h2 className="text-lg font-semibold text-text">Миний профайл</h2>
      <Card>
        <CardHeader className="gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <div
              aria-hidden="true"
              className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-lg font-semibold text-accent"
            >
              {initials(profile.name)}
            </div>
            <div className="min-w-0">
              <CardTitle className="break-words text-base">{profile.name}</CardTitle>
              <p className="mt-0.5 break-words text-sm text-text-muted">{profile.title ?? USER_ROLE_LABEL[profile.role] ?? profile.role}</p>
            </div>
          </div>
          <span
            className={cn(
              "rounded-md px-2 py-1 text-xs font-medium",
              profile.isActive ? "bg-success/15 text-success" : "bg-text-muted/15 text-text-muted"
            )}
          >
            {profile.isActive ? "Идэвхтэй" : "Идэвхгүй"}
          </span>
        </CardHeader>
        <CardBody>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            <Field label="Нэр">{profile.name}</Field>
            <Field label="И-мэйл">{profile.email}</Field>
            <Field label="Цех, тасаг">
              {profile.department ? (
                <>
                  {profile.department.name}
                  <span className="ml-2 text-xs font-normal text-text-muted">{DEPARTMENT_TYPE_LABEL[profile.department.type]}</span>
                </>
              ) : (
                <span className="text-text-muted">Оноогоогүй</span>
              )}
            </Field>
            <Field label="Албан тушаал">{profile.title ?? <span className="text-text-muted">Тодорхойгүй</span>}</Field>
            <Field label="Эрх">{USER_ROLE_LABEL[profile.role] ?? profile.role}</Field>
            <Field label="Бүртгэлийн төлөв">{profile.isActive ? "Идэвхтэй" : "Идэвхгүй"}</Field>
          </dl>
        </CardBody>
      </Card>
      <Link
        href="/settings"
        className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-bg-surface px-4 text-sm text-text hover:bg-bg-elevated"
      >
        <Settings className="size-4" aria-hidden="true" />
        Нууц үг, PIN тохиргоо
      </Link>
    </div>
  );
}
