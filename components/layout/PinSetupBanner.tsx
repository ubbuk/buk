"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldAlert } from "lucide-react";

// Shown to everyone who decides with a PIN (approver / manager role, approval position, department head) until a PIN
// exists. Covers the first sign-in and an admin reset alike: the first "Батлах" must not be the first time they hear of it.
export function PinSetupBanner() {
  const pathname = usePathname();
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me/pin")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { hasPin: boolean; needsPin?: boolean } | null) => !cancelled && setMissing(!!data && !!data.needsPin && !data.hasPin))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  if (!missing) return null;
  return (
    <div role="status" className="no-print flex flex-wrap items-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm text-warning sm:px-6">
      <ShieldAlert className="size-4 shrink-0" aria-hidden />
      <span>Та батлах эрхтэй боловч баталгаажуулах PIN тохируулаагүй байна.</span>
      {pathname !== "/settings" && (
        <Link href="/settings#pin" className="font-medium underline">
          PIN тохируулах
        </Link>
      )}
    </div>
  );
}
