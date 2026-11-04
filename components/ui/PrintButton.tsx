"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/Button";

// Prints the current page; app chrome and anything marked `no-print` is hidden by
// the @media print rules in app/globals.css.
export function PrintButton({ label = "Хэвлэх" }: { label?: string }) {
  return (
    <Button size="sm" variant="secondary" className="no-print" onClick={() => window.print()}>
      <Printer className="size-3.5" />
      {label}
    </Button>
  );
}
