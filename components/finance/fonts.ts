import { JetBrains_Mono } from "next/font/google";

// Тоонд JetBrains Mono (Cyrillic); бусад үсэг нь Inter (app/layout.tsx). Самбарын layout болон portal-оор гарах drawer хоёр ижил хувьсагчийг ашиглана.
export const mono = JetBrains_Mono({ subsets: ["latin", "cyrillic"], variable: "--font-mono-num", display: "swap" });
