"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { categoryNameWarning } from "@/lib/department-name";
import type { DepartmentInspection } from "@/lib/department-admin";

const inputClass = "focus-ring h-9 w-full rounded-lg border border-border bg-bg-elevated px-3 text-sm text-text placeholder:text-text-muted";
const NONE = "__none__";

type DeptType = "OFFICE" | "FACTORY";

/** Create (department = null) or edit name / type. A category word in the name only warns. */
export function DepartmentFormDialog({ open, department, onClose, onDone }: { open: boolean; department: { id: string; name: string; type: DeptType } | null; onClose: () => void; onDone: () => void }) {
  const { push } = useToast();
  const [name, setName] = useState("");
  const [type, setType] = useState<DeptType>("FACTORY");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(department?.name ?? "");
    setType(department?.type ?? "FACTORY");
  }, [open, department]);

  const warning = categoryNameWarning(name);
  const changed = !department || name.trim() !== department.name || type !== department.type;

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(department ? `/api/admin/departments/${department.id}` : "/api/admin/departments", {
        method: department ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), type }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        push({ kind: "error", title: department ? "Хадгалж чадсангүй" : "Цех үүсгэж чадсангүй", description: body.error });
        return;
      }
      push({ kind: "success", title: department ? "Хадгалагдлаа" : `«${name.trim()}» цех нэмэгдлээ` });
      onDone();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={department ? "Цех, тасаг засах" : "Шинэ цех, тасаг нэмэх"}>
      <div className="space-y-3">
        <label className="block space-y-1">
          <span className="text-xs text-text-muted">Нэр</span>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Жишээ: Бетон цех" autoFocus />
        </label>
        {warning && (
          <p role="alert" className="flex items-start gap-1.5 text-xs font-medium text-warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {warning}
          </p>
        )}
        <label className="block space-y-1">
          <span className="text-xs text-text-muted">Төрөл</span>
          <select className={inputClass} value={type} onChange={(e) => setType(e.target.value as DeptType)}>
            <option value="FACTORY">Үйлдвэр</option>
            <option value="OFFICE">Оффис</option>
          </select>
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Болих
          </Button>
          <Button onClick={() => void save()} disabled={!name.trim() || !changed || busy} loading={busy}>
            {department ? "Хадгалах" : "Нэмэх"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Delete / archive: where the members go (answer required), the admin password. History decides delete vs archive. */
export function DeleteDepartmentDialog({ department, onClose, onDone }: { department: { id: string; name: string } | null; onClose: () => void; onDone: () => void }) {
  const { push } = useToast();
  const [info, setInfo] = useState<DepartmentInspection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moveTo, setMoveTo] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!department) return;
    setInfo(null);
    setError(null);
    setMoveTo("");
    setPassword("");
    let cancelled = false;
    fetch(`/api/admin/departments/${department.id}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) setError(body.error ?? "Мэдээлэл татаж чадсангүй");
        else setInfo(body as DepartmentInspection);
      })
      .catch(() => !cancelled && setError("Мэдээлэл татаж чадсангүй"));
    return () => {
      cancelled = true;
    };
  }, [department]);

  const blocked = (info?.openRequests ?? 0) > 0;
  const canConfirm = !!info && !blocked && (info.members === 0 || !!moveTo) && password.length > 0 && !busy;

  async function confirm() {
    if (!department || !info) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/departments/${department.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminPassword: password, ...(info.members > 0 ? { moveTo: moveTo === NONE ? null : moveTo } : {}) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        push({ kind: "error", title: "Хасаж чадсангүй", description: body.error });
        return;
      }
      push({ kind: "success", title: body.mode === "ARCHIVED" ? `«${department.name}» архивлагдлаа` : `«${department.name}» устгагдлаа` });
      onDone();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!department} onClose={onClose} title="Цех, тасаг устгах" description={department?.name}>
      {error && <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      {!info && !error && <p className="py-6 text-center text-sm text-text-muted">Шалгаж байна...</p>}
      {info && (
        <div className="space-y-3">
          <p className="text-sm text-text-muted">
            {info.members} хэрэглэгч · {info.requests} захиалга{info.department.headName ? ` · дарга: ${info.department.headName}` : ""}
          </p>
          {blocked && (
            <p role="alert" className="flex items-start gap-1.5 text-xs font-medium text-danger">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> Дуусаагүй {info.openRequests} захиалга байна. Эхлээд тэдгээрийг дуусгах эсвэл цуцлах хэрэгтэй.
            </p>
          )}
          {info.members > 0 && (
            <label className="block space-y-1">
              <span className="text-sm font-medium text-text">Хэрэглэгчдийг хаана шилжүүлэх вэ?</span>
              <select aria-label="Хэрэглэгчдийг хаана шилжүүлэх" className={inputClass} value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                <option value="">Сонгох...</option>
                {info.targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.type === "FACTORY" ? "Үйлдвэр" : "Оффис"})
                  </option>
                ))}
                <option value={NONE}>Цехгүй (цех оноохгүй)</option>
              </select>
            </label>
          )}
          <p className="text-xs text-text-muted">
            {info.hasHistory
              ? "Захиалгын түүхтэй тул бүрмөсөн устахгүй, архивлагдана: жагсаалтаас нуугдаж, шинэ хэрэглэгчид сонгогдохгүй. Түүх хэвээр үлдэнэ."
              : "Түүхгүй тул бүрмөсөн устна."}
          </p>
          <label className="block space-y-1">
            <span className="text-xs text-text-muted">Админы нууц үг (баталгаажуулах)</span>
            <input type="password" autoComplete="current-password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Таны нууц үг" />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Болих
            </Button>
            <Button variant="danger" onClick={() => void confirm()} disabled={!canConfirm} loading={busy}>
              {info.hasHistory ? "Архивлах" : "Устгах"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
