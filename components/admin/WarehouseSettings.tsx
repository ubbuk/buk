"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import type { KeeperMode } from "@/lib/warehouse-settings";

interface WarehouseRow {
  id: string;
  name: string;
  parentId: string | null;
  keeperId: string | null;
  keeperName: string | null;
  sortPriority: number;
  onecCode: string | null;
  isActive: boolean;
}
interface Data {
  mode: KeeperMode;
  storekeepers: { id: string; name: string }[];
  warehouses: WarehouseRow[];
}

const MODE_LABEL: Record<KeeperMode, string> = {
  PRIMARY: "1-р горим: бүх хүсэлт үндсэн няравт",
  BY_WAREHOUSE: "2-р горим: материалын агуулахын няравт",
};

const selectClass = "focus-ring h-9 rounded-lg border border-border bg-bg-surface px-3 text-sm text-text";

/** Admin: the step-2 keeper mode, the keeper of every top-level warehouse and the stock reservation order. */
export function WarehouseSettings() {
  const { push } = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/warehouses");
    if (res.ok) setData(await res.json());
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefresh(() => void load());

  async function send(url: string, body: unknown, ok: string) {
    setBusy(true);
    try {
      const res = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || "Хадгалж чадсангүй");
      push({ kind: "success", title: ok });
      await load();
    } catch (err) {
      push({ kind: "error", title: err instanceof Error ? err.message : "Хадгалж чадсангүй" });
    } finally {
      setBusy(false);
    }
  }

  if (!data) return null;
  const tops = data.warehouses.filter((w) => !w.parentId);
  const childrenOf = (id: string) => data.warehouses.filter((w) => w.parentId === id);
  const leaves = data.warehouses.filter((w) => w.isActive && (w.parentId || childrenOf(w.id).length === 0));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Агуулах, нярав</CardTitle>
      </CardHeader>
      <CardBody className="space-y-5" data-testid="warehouse-settings">
        <div className="space-y-2">
          <p className="text-sm font-medium text-text">Агуулахын шалгалтыг (2-р алхам) хэн хийх вэ</p>
          <select
            aria-label="Нярав сонгох горим"
            value={data.mode}
            disabled={busy}
            onChange={(e) => void send("/api/admin/settings", { keeperMode: e.target.value }, "Горим солигдлоо")}
            className={`${selectClass} w-full max-w-md`}
          >
            {(Object.keys(MODE_LABEL) as KeeperMode[]).map((m) => (
              <option key={m} value={m}>
                {MODE_LABEL[m]}
              </option>
            ))}
          </select>
          <p className="text-xs text-text-muted">
            Зөвхөн шинэ хүсэлтэд үйлчилнэ; явж буй хүсэлт өөрийн няравтай хэвээр. Нярвын шийдвэр эцсийнх. Нярваргүй
            агуулахын хүсэлт үндсэн нярав руу очиж, аудитад тэмдэглэгдэнэ.
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-text">Агуулах бүрийн нярав</p>
          {tops.map((w) => (
            <div key={w.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-bg-elevated/40 p-3">
              <div>
                <p className="text-sm font-medium text-text">{w.name}</p>
                <p className="text-xs text-text-muted">
                  {childrenOf(w.id)
                    .map((c) => c.name)
                    .join(", ") || "Байршил бүртгэгдээгүй"}
                </p>
              </div>
              <select
                aria-label={`${w.name} нярав`}
                value={w.keeperId ?? ""}
                disabled={busy}
                onChange={(e) => void send(`/api/admin/warehouses/${w.id}`, { keeperId: e.target.value || null }, "Нярав хадгалагдлаа")}
                className={`${selectClass} w-56`}
              >
                <option value="">— Нярав байхгүй —</option>
                {data.storekeepers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-text">Нөөцлөх эрэмбэ</p>
          <p className="text-xs text-text-muted">
            Бага тоотой агуулахаас эхэлж нөөцөлнө; тэнцүү бол их үлдэгдэлтэйгээс. Нэг агуулахад хүрэлцэхгүй бол дараагийнхаас нэмж авна.
          </p>
          {leaves.map((w) => (
            <div key={w.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-elevated/40 px-3 py-2">
              <p className="text-sm text-text">{w.name}</p>
              <input
                type="number"
                min={0}
                max={10000}
                aria-label={`${w.name} эрэмбэ`}
                defaultValue={w.sortPriority}
                disabled={busy}
                onBlur={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isInteger(n) && n !== w.sortPriority) void send(`/api/admin/warehouses/${w.id}`, { sortPriority: n }, "Эрэмбэ хадгалагдлаа");
                }}
                className={`${selectClass} w-24 text-right`}
              />
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}
