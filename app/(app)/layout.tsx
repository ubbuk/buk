import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { CommandBar } from "@/components/layout/CommandBar";
import { FloatingOrderButton } from "@/components/layout/FloatingOrderButton";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { ToastProvider } from "@/components/ui/Toast";
import { RequestsLoader } from "@/components/requests/RequestsLoader";
import { authOptions } from "@/lib/auth";

// The session is re-validated against the database on every full page load of anything under (app): a revoked, deactivated or
// unknown session (lib/auth.ts jwt callback) is no session, so a direct URL never shows the application shell to it. The
// middleware only decodes the cookie; this closes that gap. Each page's data comes from API routes that check the session and the
// role again, so nothing here is the only line of defence.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  return (
    <ToastProvider>
      <RequestsLoader />
      <div className="min-h-screen bg-bg">
        <div className="no-print">
          <CommandBar />
          <FloatingOrderButton />
        </div>
        <main className="px-4 pb-24 pt-4 sm:px-6 md:pb-6">{children}</main>
        <div className="no-print">
          <MobileBottomNav />
        </div>
      </div>
    </ToastProvider>
  );
}
