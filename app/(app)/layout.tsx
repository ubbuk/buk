import { CommandBar } from "@/components/layout/CommandBar";
import { FloatingOrderButton } from "@/components/layout/FloatingOrderButton";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { ToastProvider } from "@/components/ui/Toast";
import { RequestsLoader } from "@/components/requests/RequestsLoader";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <RequestsLoader />
      <div className="min-h-screen bg-bg">
        <CommandBar />
        <FloatingOrderButton />
        <main className="px-4 pb-24 pt-4 sm:px-6 md:pb-6">{children}</main>
        <MobileBottomNav />
      </div>
    </ToastProvider>
  );
}
