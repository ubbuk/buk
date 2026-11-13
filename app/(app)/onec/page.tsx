import { ShieldAlert } from "lucide-react";
import { getServerSession } from "next-auth";
import { headers } from "next/headers";
import { FinanceTabs } from "@/components/finance/FinanceTabs";
import { OnecBrowser } from "@/components/onec-odata/OnecBrowser";
import { EmptyState } from "@/components/ui/EmptyState";
import { authOptions } from "@/lib/auth";
import { canUseOdata } from "@/lib/onec-odata/access";
import { logOdataDenied } from "@/lib/onec-odata/audit";
import { loadViewer } from "@/lib/onec-odata/viewer";

export const dynamic = "force-dynamic";

// Сервер талын хаалга: эрхгүй хэрэглэгчид юу ч харуулахгүй, оролдлогыг бүртгэнэ. /api/onec-odata/* өөрөө ижил дүрмийг
// тусад нь шалгана (хуудсыг нуух нь өгөгдлийг хамгаалахыг орлохгүй).
export default async function OnecPage() {
  const session = await getServerSession(authOptions);
  // Дүр, идэвхтэй эсэхийг хүсэлт бүрд DB-ээс уншина (session дахь дүр хуучирсан байж болно)
  const viewer = session ? await loadViewer(session.user.id) : null;

  if (!session || !viewer || !canUseOdata(viewer.role)) {
    if (session) {
      const h = await headers();
      const req = new Request("http://internal/onec", { headers: h });
      await logOdataDenied(req, session.user.id, viewer?.role ?? session.user.role, "page", "role").catch(() => {});
    }
    return <EmptyState icon={ShieldAlert} title="Эрхгүй" description="1С хөтчийг зөвхөн админ харах боломжтой" />;
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-5">
      <FinanceTabs />
      <OnecBrowser />
    </div>
  );
}
