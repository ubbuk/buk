"use client";

import { motion } from "framer-motion";
import { Check, Clock, X, Minus } from "lucide-react";
import { cn, formatDateTime } from "@/lib/utils";
import { APPROVAL_STEP_LABEL, type ApprovalStepView } from "@/lib/types";

const statusStyles = {
  APPROVED: { icon: Check, dot: "bg-success text-bg", line: "bg-success" },
  REJECTED: { icon: X, dot: "bg-danger text-bg", line: "bg-border" },
  PENDING: { icon: Clock, dot: "bg-bg-elevated text-text-muted border border-border", line: "bg-border" },
  SKIPPED: { icon: Minus, dot: "bg-bg-elevated text-text-muted border border-border", line: "bg-border" },
} as const;

export function ApprovalTimeline({ steps }: { steps: ApprovalStepView[] }) {
  return (
    <ol className="relative">
      {steps.map((step, i) => {
        const style = statusStyles[step.status];
        const Icon = style.icon;
        const isLast = i === steps.length - 1;
        return (
          <li key={step.type} className="relative flex gap-4 pb-8 last:pb-0">
            {!isLast && (
              <span
                className={cn("absolute left-[15px] top-8 h-[calc(100%-2rem)] w-px", style.line)}
                aria-hidden
              />
            )}
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: i * 0.06, duration: 0.25 }}
              className={cn(
                "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full",
                style.dot
              )}
            >
              <Icon className="size-4" />
            </motion.div>
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-text">{APPROVAL_STEP_LABEL[step.type]}</p>
                {step.decidedAt && (
                  <span className="shrink-0 text-[11px] text-text-muted">{formatDateTime(step.decidedAt)}</span>
                )}
              </div>
              <p className="text-xs text-text-muted">{step.assignedUserName}</p>
              {step.comment && (
                <p className="mt-1.5 rounded-lg border border-danger/30 bg-danger/10 px-2.5 py-1.5 text-xs text-danger">
                  {step.comment}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
