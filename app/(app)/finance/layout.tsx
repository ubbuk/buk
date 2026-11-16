import { Suspense } from "react";
import { JetBrains_Mono } from "next/font/google";
import { FactoryBanner } from "@/components/finance/FactoryBanner";
import { OneCHealthBanner } from "@/components/finance/OneCHealthBanner";
import { StaleDataBanner } from "@/components/finance/StaleDataBanner";

// Тоонд JetBrains Mono (Cyrillic); бусад үсэг нь Inter (app/layout.tsx). «Navy Gold» загвар: .ng (app/globals.css).
const mono = JetBrains_Mono({ subsets: ["latin", "cyrillic"], variable: "--font-mono-num", display: "swap" });

// useSearchParams (?ym=) ашигладаг табуудыг Suspense-ээр боож, хуудас бүтнээрээ статик болохоос сэргийлнэ
export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${mono.variable} ng mx-auto max-w-[1500px] px-4 pb-0 pt-5 sm:px-6`}>
      <Suspense fallback={null}>
        <OneCHealthBanner />
        <StaleDataBanner />
        {children}
      </Suspense>
      <FactoryBanner />
    </div>
  );
}
