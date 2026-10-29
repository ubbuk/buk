"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

type ToastKind = "success" | "error" | "info" | "warning";

interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  description?: string;
}

interface ToastContextValue {
  push: (toast: Omit<Toast, "id">) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const iconFor: Record<ToastKind, typeof Info> = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
  warning: AlertTriangle,
};

const colorFor: Record<ToastKind, string> = {
  success: "text-success border-success/30",
  error: "text-danger border-danger/30",
  info: "text-accent border-accent/30",
  warning: "text-warning border-warning/30",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((toast: Omit<Toast, "id">) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { ...toast, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2">
        <AnimatePresence>
          {toasts.map((t) => {
            const Icon = iconFor[t.kind];
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.18 }}
                className={cn(
                  "pointer-events-auto flex items-start gap-3 rounded-xl border bg-bg-elevated p-4 shadow-elevated",
                  colorFor[t.kind]
                )}
              >
                <Icon className="mt-0.5 size-4 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-text">{t.title}</p>
                  {t.description && <p className="mt-0.5 text-xs text-text-muted">{t.description}</p>}
                </div>
                <button
                  onClick={() => dismiss(t.id)}
                  className="focus-ring rounded text-text-muted hover:text-text"
                >
                  <X className="size-3.5" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
