"use client";

import { useSession } from "next-auth/react";
import { EmptyState } from "@/components/ui/EmptyState";
import { ForeignTradeForm } from "@/components/foreign-trade/ForeignTradeForm";

export default function NewForeignTradePage() {
  const { data: session, status } = useSession();
  if (status === "authenticated" && session.user.role !== "BOSS") {
    return <EmptyState title="Эрхгүй" description="Гадаад худалдааны захиалгыг зөвхөн цехийн дарга (BOSS) үүсгэнэ" />;
  }
  return <ForeignTradeForm />;
}
