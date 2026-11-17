"use client";

import Image from "next/image";
import type { LucideIcon } from "lucide-react";
import type { DataTableColumn } from "@/components/ui/DataTable";
import { cn } from "@/lib/utils";

// «Борлуулалтын шинжилгээ» хуудасны зөвхөн харагдацын бүрэлдэхүүнүүд. Өгөгдөл, тооцоо хуудаснаас шууд дамжина; энд шинэ тоо бодохгүй.

/** Толгойн брэнд тэмдэг: УБ БҮК ХК */
export function BrandMark() {
  return (
    <div className="cc-brand">
      <Image src="/images/ubbuk-logo-mark.webp" alt="" width={40} height={40} className="size-10 object-contain" />
      <div className="leading-tight">
        <p className="cc-brand-name">УБ БҮК ХК</p>
        <p className="cc-brand-sub">Ulaanbaatar Buk JSC</p>
      </div>
    </div>
  );
}

type Accent = "gold" | "green" | "blue" | "violet";

/** KPI карт: зүүн талд дүрс, голд гарчиг/том тоо/тайлбар, баруун талд заавал биш ring. `ring`: 0-100 хоорондох бодит хувь */
export function CcKpi({ label, value, icon: Icon, accent, hint, ring, spark }: { label: string; value: string; icon: LucideIcon; accent: Accent; hint?: string; ring?: number | null; spark?: React.ReactNode }) {
  return (
    <div className={cn("cc-kpi", `cc-${accent}`)}>
      {spark}
      <span className="cc-kpi-icon">
        <Icon className="size-[22px]" />
      </span>
      <div className="cc-kpi-text">
        <p className="cc-kpi-label">{label}</p>
        <p className="cc-kpi-value ng-num">{value}</p>
        {hint && <p className="cc-kpi-hint">{hint}</p>}
      </div>
      {ring != null && <Ring pct={ring} />}
    </div>
  );
}

function Ring({ pct }: { pct: number }) {
  const p = Math.max(0, Math.min(100, pct));
  const r = 20;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 52 52" className="cc-ring" aria-hidden>
      <circle cx="26" cy="26" r={r} fill="none" stroke="rgba(110,170,235,0.18)" strokeWidth="6" />
      <circle cx="26" cy="26" r={r} fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(p / 100) * c} ${c}`} transform="rotate(-90 26 26)" />
    </svg>
  );
}

/** Панелийн толгой: дүрс, гарчиг, баруун талд нэмэлт агуулга */
export function PanelHead({ icon: Icon, title, aside }: { icon: LucideIcon; title: string; aside?: React.ReactNode }) {
  return (
    <div className="cc-panel-head">
      <span className="cc-panel-icon">
        <Icon className="size-4" />
      </span>
      <h3>{title}</h3>
      {aside && <div className="ml-auto">{aside}</div>}
    </div>
  );
}

/**
 * Голд байрлах үйлдвэрийн hologram: хуучин `factory.png` зургийг том болгож, хоёр захаас бүдгэрүүлнэ; доор нь CSS-ээр зурсан гэрэлтэх тавцан.
 * Зөвхөн гоёл (aria-hidden); хөдөлгөөн нь `prefers-reduced-motion` үед унтарна.
 */
export function Hologram() {
  return (
    <div className="cc-holo" aria-hidden>
      <div className="cc-holo-platform" />
      <Image src="/images/factory.png" alt="" width={1875} height={130} sizes="(min-width: 1024px) 130vw, 200vw" priority className="cc-holo-img" />
    </div>
  );
}

/** Өртгийн задаргааны donut: хоёр бодит хэсгийн харьцаа */
export function CostDonut({ parts }: { parts: { label: string; value: number; color: string; money: string }[] }) {
  const sum = parts.reduce((a, p) => a + Math.max(p.value, 0), 0);
  const r = 44;
  const c = 2 * Math.PI * r;
  let off = 0;
  return (
    <svg viewBox="0 0 120 120" className="cc-donut" role="img" aria-label={parts.map((p) => `${p.label}: ${p.money}`).join(", ")}>
      <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(110,170,235,0.14)" strokeWidth="13" />
      {sum > 0 &&
        parts.map((p) => {
          const len = (Math.max(p.value, 0) / sum) * c;
          const el = <circle key={p.label} cx="60" cy="60" r={r} fill="none" stroke={p.color} strokeWidth="13" strokeDasharray={`${Math.max(len - 1.5, 0)} ${c}`} strokeDashoffset={-off} transform="rotate(-90 60 60)" />;
          off += len;
          return el;
        })}
    </svg>
  );
}

/** Эрэмбийн тэмдэг: 1 алтан, 2-3 цэнхэр хүрээтэй, бусад нам */
export function CcRank({ n }: { n: number }) {
  return <span className={cn("cc-rank ng-num", n === 1 ? "cc-rank-1" : n <= 3 ? "cc-rank-top" : "")}>{n}</span>;
}

/** Анхны эрэмбээр дугаарлах багана (хайлт, эрэмбэлэлтэд хамаарахгүй). Shared `rankColumn`-ыг хөндөхгүйн тулд хуудсанд зориулан хийв. */
export function ccRankColumn<T>(data: readonly T[]): DataTableColumn<T> {
  const index = new Map<T, number>(data.map((r, i) => [r, i + 1]));
  return { key: "__rank", header: "#", accessor: (r) => index.get(r) ?? null, render: (r) => <CcRank n={index.get(r) ?? 0} />, className: "w-10" };
}

/** Мөрийн доорх нарийн харьцангуй зурвас (баганын хамгийн их утгад харьцуулсан; тоо биш, зөвхөн дүрслэл) */
export function ShareBar({ value, max }: { value: number; max: number }) {
  const w = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <span className="cc-bar" aria-hidden>
      <span style={{ width: `${w}%` }} />
    </span>
  );
}
