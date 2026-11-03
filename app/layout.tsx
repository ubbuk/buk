import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { SessionProviderWrapper } from "@/components/auth/SessionProviderWrapper";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import "./globals.css";

// Always start in dark mode: set before hydration so the first paint is dark.
// (The toggle only lasts for the current page load.)
const noFlashThemeScript = `document.documentElement.classList.add('dark');`;

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "УБ БҮК — Худалдан авалтын систем",
  description: "Улаанбаатар БҮК ХК-ийн материалын захиалга, баталгаажуулалт, худалдан авалтын систем",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="mn" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashThemeScript }} />
      </head>
      <body className="font-sans">
        <SessionProviderWrapper>
          <ThemeProvider>{children}</ThemeProvider>
        </SessionProviderWrapper>
      </body>
    </html>
  );
}
