"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { inputClass } from "@/components/finance/FinanceShell";
import { CATEGORY_IDS, CATEGORY_LABEL, RULE_DIRECTIONS, RULE_DIRECTION_LABEL, RULE_FIELDS, RULE_FIELD_LABEL, type CategoryId, type RuleDirection, type RuleField } from "@/lib/onec/cash-categories";

interface Rule {
  id: string;
  direction: RuleDirection;
  field: RuleField;
  pattern: string;
  category: CategoryId;
  priority: number;
  isActive: boolean;
  note: string | null;
}
interface DefaultRule {
  direction: RuleDirection;
  field: RuleField;
  pattern: string;
  categoryLabel: string;
}

const CATEGORY_CHOICES = CATEGORY_IDS.filter((c) => c !== "internal"); // дотоод шилжүүлэг нь дүрмээр биш, бичилтийн хэлбэрээр тодорхойлогдоно

// «Мөнгөн хөрөнгө» табын ангиллын дүрэм (зөвхөн ADMIN). Энд нэмсэн дүрэм код доторх анхдагчаас ӨМНӨ үнэлэгдэнэ.
export default function CashRulesPage() {
  const { push } = useToast();
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [defaults, setDefaults] = useState<DefaultRule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ direction: "ANY" as RuleDirection, field: "PARTY" as RuleField, pattern: "", category: "other" as CategoryId, priority: 100, note: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/cash-rules");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? `Алдаа ${res.status}`);
      return;
    }
    setRules(body.rules);
    setDefaults(body.defaults);
    setError(null);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function send(url: string, method: string, payload?: unknown, okTitle?: string) {
    setBusy(true);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: payload === undefined ? undefined : JSON.stringify(payload) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Алдаа ${res.status}`);
      if (okTitle) push({ kind: "success", title: okTitle });
      await load();
      return true;
    } catch (e) {
      push({ kind: "error", title: "Хадгалж чадсангүй", description: e instanceof Error ? e.message : undefined });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const ok = await send("/api/admin/cash-rules", "POST", { ...draft, note: draft.note.trim() || null }, "Дүрэм нэмэгдлээ");
    if (ok) setDraft({ ...draft, pattern: "", note: "" });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/finance/cash" className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-text-muted hover:text-text">
          <ArrowLeft className="size-4" /> Мөнгөн хөрөнгө
        </Link>
        <h2 className="text-lg font-semibold text-text">Мөнгөний гүйлгээний ангиллын дүрэм</h2>
      </div>
      <p className="max-w-3xl text-sm text-text-muted">
        Банкны гүйлгээ нэг дүрмээр ангилалд орно: «Нийлүүлэгчид», «Цалин», «Цахилгаан, ус, түлш» гэх мэт. Таны нэмсэн дүрэм (эрэмбэ бага нь түрүүлж) системийн анхдагч дүрмээс өмнө шалгагдана. Аль нь ч таарахгүй бол «Бусад» болно.
        Өөрчлөлт бүр аудитад бүртгэгдэнэ.
      </p>
      {error && (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Шинэ дүрэм</CardTitle>
        </CardHeader>
        <CardBody className="grid gap-3 md:grid-cols-6">
          <label className="space-y-1 text-xs text-text-muted md:col-span-1">
            Чиглэл
            <select value={draft.direction} onChange={(e) => setDraft({ ...draft, direction: e.target.value as RuleDirection })} className={`${inputClass} w-full`}>
              {RULE_DIRECTIONS.map((d) => (
                <option key={d} value={d}>
                  {RULE_DIRECTION_LABEL[d]}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-text-muted md:col-span-2">
            Юуг шалгах
            <select value={draft.field} onChange={(e) => setDraft({ ...draft, field: e.target.value as RuleField })} className={`${inputClass} w-full`}>
              {RULE_FIELDS.map((f) => (
                <option key={f} value={f}>
                  {RULE_FIELD_LABEL[f]}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-text-muted md:col-span-2">
            {draft.field === "ACCOUNT" ? "Дансны кодын эхлэл (жишээ: 3101)" : "Агуулсан үг (жишээ: цахилгаан)"}
            <input value={draft.pattern} onChange={(e) => setDraft({ ...draft, pattern: e.target.value })} className={`${inputClass} w-full`} maxLength={80} />
          </label>
          <label className="space-y-1 text-xs text-text-muted md:col-span-1">
            Ангилал
            <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as CategoryId })} className={`${inputClass} w-full`}>
              {CATEGORY_CHOICES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-text-muted md:col-span-1">
            Эрэмбэ
            <input type="number" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) || 0 })} className={`${inputClass} w-full`} />
          </label>
          <label className="space-y-1 text-xs text-text-muted md:col-span-4">
            Тайлбар (заавал биш)
            <input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} className={`${inputClass} w-full`} maxLength={200} />
          </label>
          <div className="flex items-end md:col-span-1">
            <Button onClick={add} loading={busy} disabled={!draft.pattern.trim()}>
              <Plus className="size-4" /> Нэмэх
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Таны дүрмүүд {rules ? `(${rules.length})` : ""}</CardTitle>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-xs text-text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Эрэмбэ</th>
                <th className="px-2 py-2 font-medium">Чиглэл</th>
                <th className="px-2 py-2 font-medium">Шалгах</th>
                <th className="px-2 py-2 font-medium">Үг / код</th>
                <th className="px-2 py-2 font-medium">Ангилал</th>
                <th className="px-2 py-2 font-medium">Идэвхтэй</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rules?.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-text-muted">
                    Дүрэм алга: зөвхөн системийн анхдагч дүрмүүд ажиллаж байна.
                  </td>
                </tr>
              )}
              {rules?.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      defaultValue={r.priority}
                      aria-label="Эрэмбэ"
                      onBlur={(e) => Number(e.target.value) !== r.priority && send(`/api/admin/cash-rules/${r.id}`, "PATCH", { priority: Number(e.target.value) || 0 })}
                      className={`${inputClass} w-20`}
                    />
                  </td>
                  <td className="px-2 py-2 text-text-muted">{RULE_DIRECTION_LABEL[r.direction]}</td>
                  <td className="px-2 py-2 text-text-muted">{RULE_FIELD_LABEL[r.field]}</td>
                  <td className="px-2 py-2 text-text">
                    {r.pattern}
                    {r.note && <span className="block text-xs text-text-muted">{r.note}</span>}
                  </td>
                  <td className="px-2 py-2">
                    <select value={r.category} onChange={(e) => send(`/api/admin/cash-rules/${r.id}`, "PATCH", { category: e.target.value })} aria-label="Ангилал" className={inputClass}>
                      {CATEGORY_CHOICES.map((c) => (
                        <option key={c} value={c}>
                          {CATEGORY_LABEL[c]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <input type="checkbox" checked={r.isActive} aria-label="Идэвхтэй" onChange={(e) => send(`/api/admin/cash-rules/${r.id}`, "PATCH", { isActive: e.target.checked })} className="size-5" />
                  </td>
                  <td className="px-2 py-2 text-right">
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-label="Дүрэм устгах"
                      onClick={() => window.confirm(`«${r.pattern}» дүрмийг устгах уу?`) && send(`/api/admin/cash-rules/${r.id}`, "DELETE", undefined, "Дүрэм устгагдлаа")}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <details className="rounded-xl border border-border bg-bg-surface">
        <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-text">Системийн анхдагч дүрмүүд ({defaults.length}, зөвхөн унших)</summary>
        <ul className="divide-y divide-border border-t border-border text-sm">
          {defaults.map((d, i) => (
            <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2 text-text-muted">
              <span className="w-16">{RULE_DIRECTION_LABEL[d.direction]}</span>
              <span className="min-w-0 flex-1">
                {RULE_FIELD_LABEL[d.field]}: <span className="text-text">{d.pattern}</span>
              </span>
              <span className="text-text">→ {d.categoryLabel}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
