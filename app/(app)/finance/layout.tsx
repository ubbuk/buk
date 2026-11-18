import { Suspense } from "react";
import { DocDrawerProvider } from "@/components/finance/docs/DocDrawer";
import { FactoryBanner } from "@/components/finance/FactoryBanner";
import { mono } from "@/components/finance/fonts";
import { OneCHealthBanner } from "@/components/finance/OneCHealthBanner";
import { StaleDataBanner } from "@/components/finance/StaleDataBanner";

// Тоонд JetBrains Mono (components/finance/fonts.ts); бусад үсэг нь Inter (app/layout.tsx). «Navy Gold» загвар: .ng (app/globals.css).
// useSearchParams (?ym=) ашигладаг табуудыг Suspense-ээр боож, хуудас бүтнээрээ статик болохоос сэргийлнэ
export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${mono.variable} ng mx-auto max-w-[1500px] px-4 pb-0 pt-5 sm:px-6`}>
      <Suspense fallback={null}>
        <OneCHealthBanner />
        <StaleDataBanner />
        <DocDrawerProvider>{children}</DocDrawerProvider>
      </Suspense>
      <FactoryBanner />
    </div>
  );
}
