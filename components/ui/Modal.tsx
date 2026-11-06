"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.16 }}
            className={cn(
              "relative z-10 flex max-h-[90dvh] w-full max-w-md flex-col rounded-t-2xl border border-border bg-bg-surface shadow-elevated sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl",
              className
            )}
          >
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div className="min-w-0 break-words">
                <h2 id="modal-title" className="text-sm font-semibold text-text">
                  {title}
                </h2>
                {description && <p className="mt-1 text-xs text-text-muted">{description}</p>}
              </div>
              <button
                onClick={onClose}
                aria-label="Хаах"
                className="focus-ring -m-3 flex size-11 shrink-0 items-center justify-center rounded text-text-muted hover:text-text"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="min-h-0 overflow-y-auto overscroll-contain p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
