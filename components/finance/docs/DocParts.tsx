"use client";

import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, FileText, RefreshCw } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { DocTone } from "@/lib/onec/doc-kinds";
import { cn } from "@/lib/utils";

// Баримтын төрлийн өнгө, дүрс: орлого ногоон, зарлага улаан, шилжүүлэг хөх, бусад саарал.
const TONE: Record<DocTone, { icon: LucideIcon; box: string; text: string; word: string }> = {
  in: { icon: ArrowDownToLine, box: "border-success/40 bg-success/15", text: "text-success", word: "Орлого" },
  out: { icon: ArrowUpFromLine, box: "border-danger/40 bg-danger/15", text: "text-danger", word: "Зарлага" },
  move: { icon: ArrowLeftRight, box: "border-[rgba(106,167,255,0.5)] bg-[rgba(80,140,240,0.18)]", text: "text-[#6aa7ff]", word: "Шилжүүлэг" },
  other: { icon: FileText, box: "border-border bg-white/5", text: "text-text-muted", word: "Бусад" },
};

export const toneText = (tone: DocTone) => TONE[tone].text;
export const toneWord = (tone: DocTone) => TONE[tone].word;

export function ToneIcon({ tone, size = "md" }: { tone: DocTone; size?: "sm" | "md" | "lg" }) {
  const t = TONE[tone];
  const Icon = t.icon;
  return (
    <span aria-hidden className={cn("flex shrink-0 items-center justify-center rounded-xl border", t.box, t.text, size === "sm" ? "size-8" : size === "md" ? "size-10" : "size-12")}>
      <Icon className={size === "lg" ? "size-6" : "size-5"} />
    </span>
  );
}

/** 1С холбогдохгүй, хугацаа хэтэрсэн зэрэг алдааг ойлгомжтой мессеж + «Дахин оролдох» товчтой харуулна */
export function OnecError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const offline = /холбогдож чадсангүй|хугацаандаа|нэвтрэлт|холбогдоогүй/.test(message);
  return (
    <div role="alert" className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
      <p className="font-medium">{offline ? "1С-тэй холбогдож чадсангүй" : "Өгөгдөл татаж чадсангүй"}</p>
      <p className="mt-0.5 text-xs text-warning/90">{offline ? `${message}. Түр хүлээгээд дахин оролдоно уу. Хуудсанд өмнө нь харагдсан мэдээлэл өөрчлөгдөөгүй.` : message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="focus-ring mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg border border-warning/50 px-3 text-xs font-medium hover:bg-warning/10">
          <RefreshCw className="size-3.5" aria-hidden />
          Дахин оролдох
        </button>
      )}
    </div>
  );
}
