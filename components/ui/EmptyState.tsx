import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl border border-border bg-bg-elevated">
        <Icon className="size-5 text-text-muted" />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-text">{title}</p>
        {description && <p className="max-w-sm text-sm text-text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
