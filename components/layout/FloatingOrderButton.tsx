"use client";

import { usePathname } from "next/navigation";
import { TruckButton } from "@/components/ui/TruckButton";


const HIDDEN_ON = ["/requests"];

export function FloatingOrderButton() {
  const pathname = usePathname() ?? "";
  if (HIDDEN_ON.some((p) => pathname === p || pathname.startsWith(p + "/"))) return null;

  return (
    <div className="pointer-events-none fixed right-2 top-16 z-40 hidden p-10 md:block [&>*]:pointer-events-auto">
      <TruckButton href="/requests/new" label="Шинэ захиалга" large />
    </div>
  );
}
