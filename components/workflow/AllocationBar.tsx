"use client";

import { motion } from "framer-motion";
import { formatNumber } from "@/lib/utils";

export function AllocationBar({
  requested,
  allocated,
  unit,
}: {
  requested: number;
  allocated: number;
  unit: string;
}) {
  const missing = Math.max(requested - allocated, 0);
  const allocatedPct = requested > 0 ? Math.min((allocated / requested) * 100, 100) : 0;
  const missingPct = 100 - allocatedPct;

  return (
    <div className="w-full">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-bg-elevated">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${allocatedPct}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="h-full bg-success"
        />
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${missingPct}%` }}
          transition={{ duration: 0.6, ease: "easeOut", delay: 0.1 }}
          className="h-full bg-danger/70"
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[11px]">
        <span className="flex items-center gap-1.5 text-success">
          <span className="size-1.5 rounded-full bg-success" />
          Олгох: {formatNumber(allocated)} {unit}
        </span>
        {missing > 0 && (
          <span className="flex items-center gap-1.5 text-danger">
            <span className="size-1.5 rounded-full bg-danger" />
            Дутуу: {formatNumber(missing)} {unit}
          </span>
        )}
      </div>
    </div>
  );
}
