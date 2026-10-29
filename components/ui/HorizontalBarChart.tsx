"use client";

import { motion } from "framer-motion";
import { formatCurrency } from "@/lib/utils";

export function HorizontalBarChart({
  data,
}: {
  data: { label: string; value: number }[];
}) {
  const max = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="space-y-3" role="img" aria-label="Цех тасгуудын зарцуулалтын харьцуулалт">
      {data.map((d) => (
        <div key={d.label}>
          <div className="mb-1 flex items-baseline justify-between text-xs">
            <span className="text-text-muted">{d.label}</span>
            <span className="font-medium text-text">{formatCurrency(d.value)}</span>
          </div>
          <div className="h-2 w-full rounded-full bg-bg-elevated">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(d.value / max) * 100}%` }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className="h-full rounded-full bg-accent"
            />
          </div>
        </div>
      ))}
    </div>
  );
}
