"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { inputClass } from "@/components/finance/FinanceShell";
import { formatMoneyShort } from "@/lib/money-short";

interface Row {
  key: string;
  id: string;
  description: string;
  number: string;
  currency: string;
  kind: "bank" | "cash";
  closing: number;
  name: string;
  hidden: boolean;
  sortOrder: number | null;
}

// «Мөнгөн хөрөнгө» табын «Данснууд»: данс бүрт нэр өгөх («Үндсэн данс», «Цалингийн данс», «Валютын данс»), нуух, дараалал (зөвхөн ADMIN).
// Нэр өгөөгүй бол банк + сүүлийн 4 орон. Зөвхөн харагдац: үлдэгдэл, гүйлгээнд нөлөөгүй. Бүтэн дугаар зөвхөн энд (ADMIN).
export default function CashAccountsAdminPage() {
  const { push } = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [maxName, setMaxName] = useState(60);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/cash-accounts");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? `Алдаа ${res.status}`);
      return;
    }
    setRows(body.accounts);
    setMaxName(body.maxName ?? 60);
    setError(null);
    setDirty(false);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const patch = (key: string, p: Partial<Row>) => {
    setRows((rs) => rs && rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
    setDirty(true);
  };

  async function save() {
    if (!rows) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/cash-accounts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: rows.map((r) => ({ key: r.key, name: r.name, hidden: r.hidden, sortOrder: r.sortOrder })) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Алдаа ${res.status}`);
      push({ kind: "success", title: "Хадгалагдлаа" });
      await load();
    } catch (e) {
      push({ kind: "error", title: "Хадгалж чадсангүй", description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/finance/cash" className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-text-muted hover:text-text">
          <ArrowLeft className="size-4" /> Мөнгөн хөрөнгө
        </Link>
        <h2 className="text-lg font-semibold text-text">Дансны нэр, дараалал</h2>
      </div>
      <p className="max-w-3xl text-sm text-text-muted">
        Данс бүрт ойлгомжтой нэр өгнө («Үндсэн данс», «Цалингийн данс», «Валютын данс»). Нэр өгөөгүй бол «банк + сүүлийн 4 орон» гарна. Нуусан данс картад гарахгүй ч нийт үлдэгдэлд орно. Дараалал (1, 2, 3 ...) өгөөгүй бол үлдэгдэл ихээс нь эхэлнэ.
        Өөрчлөлт аудитад бүртгэгдэнэ.
      </p>
      {error && (
        <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Данснууд</CardTitle>
          <Button onClick={save} disabled={busy || !dirty}>
            Хадгалах
          </Button>
        </CardHeader>
        <CardBody className="p-0">
          {!rows ? (
            <p className="px-5 py-8 text-sm text-text-muted">Уншиж байна…</p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((r) => (
                <li key={r.key} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_5rem_6rem] md:items-center">
                  <div className="min-w-0">
                    <p className="break-words text-sm text-text">{r.description}</p>
                    <p className="ng-num break-all text-xs text-text-muted">
                      {r.number ? `№ ${r.number} · ` : ""}
                      {formatMoneyShort(r.closing)}
                    </p>
                  </div>
                  <label className="text-xs text-text-muted">
                    <span className="sr-only">Нэр</span>
                    <input value={r.name} maxLength={maxName} onChange={(e) => patch(r.key, { name: e.target.value })} placeholder="Нэр (заавал биш)" className={`${inputClass} w-full`} />
                  </label>
                  <label className="text-xs text-text-muted">
                    Дараалал
                    <input
                      type="number"
                      min={1}
                      max={999}
                      value={r.sortOrder ?? ""}
                      onChange={(e) => patch(r.key, { sortOrder: e.target.value === "" ? null : Math.max(1, Math.min(999, Math.round(Number(e.target.value)) || 1)) })}
                      className={`${inputClass} w-full`}
                    />
                  </label>
                  <label className="flex min-h-11 items-center gap-2 text-sm text-text">
                    <input type="checkbox" checked={r.hidden} onChange={(e) => patch(r.key, { hidden: e.target.checked })} className="size-4" />
                    Нуух
                  </label>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
