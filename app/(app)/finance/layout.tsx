import { Suspense } from "react";
import { OneCHealthBanner } from "@/components/finance/OneCHealthBanner";

// useSearchParams (?ym=) ашигладаг табуудыг Suspense-ээр боож, хуудас бүтнээрээ статик болохоос сэргийлнэ
export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <OneCHealthBanner />
      {children}
    </Suspense>
  );
}
