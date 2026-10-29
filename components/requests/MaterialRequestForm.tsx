"use client";

import {
  AlertCircle,
  CheckCircle2,
  Paperclip,
  Plus,
  Save,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { DemoDataBadge } from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/Toast";
import { DEMO_DEPARTMENTS, DEMO_CURRENT_USER } from "@/lib/mock-session";
import { DEMO_MATERIALS } from "@/lib/mock-data";
import { useRequestStore } from "@/lib/store";
import { cn, formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import { validateItem, type FieldErrors } from "@/lib/validation";
import type { MaterialCatalogEntry } from "@/lib/types";
import { MaterialCombobox } from "./MaterialCombobox";

interface Row {
  id: string;
  materialId: string | null;
  materialName: string;
  warehouseBalance: number | null;
  unit: string;
  requestedQuantity: number | "";
  unitPrice: number | "";
  note: string;
}

const DRAFT_KEY = "ubbuk:material-request-draft";

function emptyRow(): Row {
  return {
    id: crypto.randomUUID(),
    materialId: null,
    materialName: "",
    warehouseBalance: null,
    unit: "",
    requestedQuantity: "",
    unitPrice: "",
    note: "",
  };
}

export function MaterialRequestForm() {
  const { push } = useToast();
  const searchParams = useSearchParams();
  const [departmentId, setDepartmentId] = useState(DEMO_CURRENT_USER.departmentId);
  const [route, setRoute] = useState<"OFFICE" | "FACTORY">(
    DEMO_DEPARTMENTS.find((d) => d.id === DEMO_CURRENT_USER.departmentId)?.type ?? "FACTORY"
  );
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [urgent, setUrgent] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, FieldErrors>>({});
  const [dirty, setDirty] = useState(false);
  const [submitted, setSubmitted] = useState<{ id: string; requestNumber: string; nextApprover: string } | null>(
    null
  );
  const createRequest = useRequestStore((s) => s.createRequest);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const restoredRef = useRef(false);

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw);
        if (draft.rows?.length) setRows(draft.rows);
        if (draft.departmentId) setDepartmentId(draft.departmentId);
        if (draft.route) setRoute(draft.route);
        if (draft.note) setNote(draft.note);
        push({ kind: "info", title: "Хадгалсан ноорог сэргээгдлээ" });
        return;
      }
    } catch {
      // corrupted draft — ignore and start fresh
    }

    const materialId = searchParams.get("material");
    const isUrgent = searchParams.get("urgent") === "1";
    if (materialId) {
      const material = DEMO_MATERIALS.find((m) => m.id === materialId);
      if (material) {
        setRows([
          {
            ...emptyRow(),
            materialId: material.id,
            materialName: material.name,
            warehouseBalance: material.warehouseBalance,
            unit: material.unit,
            unitPrice: material.defaultPrice,
          },
        ]);
      }
    }
    if (isUrgent) {
      setUrgent(true);
      setNote((prev) => prev || "Яаралтай шаардлагатай — агуулахын нөөц хүрэлцэхгүй байна");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!dirty || submitted) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, submitted]);

  function markDirty() {
    setDirty(true);
  }

  function updateRow(id: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    markDirty();
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow()]);
    markDirty();
  }

  function removeRow(id: string) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));
    setErrors((prev) => {
      if (!(id in prev)) return prev;
      const rest = { ...prev };
      delete rest[id];
      return rest;
    });
    markDirty();
  }

  function onMaterialSelect(id: string, material: MaterialCatalogEntry) {
    updateRow(id, {
      materialId: material.id,
      materialName: material.name,
      warehouseBalance: material.warehouseBalance,
      unit: material.unit,
      unitPrice: material.defaultPrice,
    });
  }

  const total = useMemo(
    () =>
      rows.reduce((sum, r) => {
        const qty = typeof r.requestedQuantity === "number" ? r.requestedQuantity : 0;
        const price = typeof r.unitPrice === "number" ? r.unitPrice : 0;
        return sum + qty * price;
      }, 0),
    [rows]
  );

  function saveDraft() {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ rows, departmentId, route, note, savedAt: new Date().toISOString() })
    );
    setDirty(false);
    push({ kind: "success", title: "Ноорог хадгалагдлаа", description: "Та дараа нэвтрэхдээ үргэлжлүүлэх боломжтой" });
  }

  function validateAll(): boolean {
    const nextErrors: Record<string, FieldErrors> = {};
    let valid = true;
    for (const row of rows) {
      const errs = validateItem({
        id: row.id,
        materialId: row.materialId,
        materialName: row.materialName,
        warehouseBalance: row.warehouseBalance,
        unit: row.unit,
        requestedQuantity: typeof row.requestedQuantity === "number" ? row.requestedQuantity : NaN,
        unitPrice: typeof row.unitPrice === "number" ? row.unitPrice : NaN,
        note: row.note,
      });
      if (Object.keys(errs).length > 0) {
        nextErrors[row.id] = errs;
        valid = false;
      }
    }
    setErrors(nextErrors);
    return valid;
  }

  function submit() {
    if (!validateAll()) {
      push({ kind: "error", title: "Маягтад алдаа байна", description: "Улаанаар тэмдэглэгдсэн талбаруудыг засна уу" });
      return;
    }
    const newRequest = createRequest({
      departmentId,
      route,
      requestedBy: DEMO_CURRENT_USER.name,
      items: rows.map((r) => ({
        materialName: r.materialName,
        unit: r.unit,
        requestedQuantity: typeof r.requestedQuantity === "number" ? r.requestedQuantity : 0,
        unitPrice: typeof r.unitPrice === "number" ? r.unitPrice : 0,
        warehouseBalance: r.warehouseBalance,
        note: r.note || undefined,
      })),
    });
    localStorage.removeItem(DRAFT_KEY);
    setDirty(false);
    setSubmitted({
      id: newRequest.id,
      requestNumber: newRequest.requestNumber,
      nextApprover: newRequest.approvalSteps[0].assignedUserName,
    });
  }

  function resetForm() {
    setRows([emptyRow()]);
    setDepartmentId(DEMO_CURRENT_USER.departmentId);
    setNote("");
    setUrgent(false);
    setAttachments([]);
    setErrors({});
    setSubmitted(null);
    setDirty(false);
  }

  if (submitted) {
    return (
      <Card className="mx-auto max-w-lg">
        <CardBody className="flex flex-col items-center gap-4 py-12 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-success/15 text-success">
            <CheckCircle2 className="size-7" />
          </div>
          <div>
            <p className="text-lg font-semibold text-text">Захиалга амжилттай илгээгдлээ</p>
            <p className="mt-1 text-sm text-text-muted">
              Захиалгын дугаар <span className="font-medium text-text">№{submitted.requestNumber}</span>
            </p>
          </div>
          <div className="w-full rounded-lg border border-border bg-bg-elevated/50 p-3 text-sm">
            <p className="text-text-muted">Дараагийн баталгаажуулагч</p>
            <p className="mt-0.5 font-medium text-text">{submitted.nextApprover}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={resetForm}>
              Шинэ захиалга үүсгэх
            </Button>
            <Link href={`/requests/${submitted.id}`}>
              <Button>Захиалгыг харах</Button>
            </Link>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>Маягт №1 — Материалын захиалгын хуудас</CardTitle>
            {urgent && (
              <span className="inline-flex items-center gap-1 rounded-full border border-danger/30 bg-danger/10 px-2.5 py-1 text-[11px] font-medium text-danger">
                Яаралтай
              </span>
            )}
            <DemoDataBadge />
          </div>
          <span className="text-xs text-text-muted">
            Огноо: <span suppressHydrationWarning>{formatDate(new Date())}</span>
          </span>
        </CardHeader>
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Цех, тасгийн нэр">
            <select
              value={departmentId}
              onChange={(e) => {
                setDepartmentId(e.target.value);
                const dept = DEMO_DEPARTMENTS.find((d) => d.id === e.target.value);
                if (dept) setRoute(dept.type);
                markDirty();
              }}
              className="focus-ring h-9 w-full rounded-lg border border-border bg-bg-elevated px-3 text-sm text-text"
            >
              {DEMO_DEPARTMENTS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Захиалга үүсгэсэн ажилтан">
            <input
              disabled
              value={DEMO_CURRENT_USER.name}
              className="h-9 w-full rounded-lg border border-border bg-bg-elevated/50 px-3 text-sm text-text-muted"
            />
          </Field>

          <Field label="Захиалгын чиглэл">
            <div className="flex h-9 items-center gap-1 rounded-lg border border-border bg-bg-elevated p-1">
              {(["FACTORY", "OFFICE"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    setRoute(r);
                    markDirty();
                  }}
                  className={cn(
                    "focus-ring h-full flex-1 rounded-md text-xs font-medium transition-colors",
                    route === r ? "bg-accent text-bg" : "text-text-muted hover:text-text"
                  )}
                >
                  {r === "FACTORY" ? "Үйлдвэр" : "Оффис"}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Тайлбар (заавал биш)">
            <input
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                markDirty();
              }}
              placeholder="Нэмэлт тайлбар..."
              className="focus-ring h-9 w-full rounded-lg border border-border bg-bg-elevated px-3 text-sm text-text placeholder:text-text-muted"
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Захиалах материал</CardTitle>
          <Button variant="secondary" size="sm" onClick={addRow}>
            <Plus className="size-3.5" />
            Мөр нэмэх
          </Button>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-text-muted">
                <th className="w-10 px-4 py-2.5 font-medium">№</th>
                <th className="min-w-[220px] px-3 py-2.5 font-medium">Захиалах сэлбэг, материалын нэр</th>
                <th className="w-28 px-3 py-2.5 font-medium">Агуулахын үлдэгдэл</th>
                <th className="w-20 px-3 py-2.5 font-medium">Хэмжих нэгж</th>
                <th className="w-24 px-3 py-2.5 font-medium">Тоо</th>
                <th className="w-28 px-3 py-2.5 font-medium">Нэгж үнэ</th>
                <th className="w-28 px-3 py-2.5 font-medium">Бүгд үнэ</th>
                <th className="min-w-[140px] px-3 py-2.5 font-medium">Тайлбар</th>
                <th className="w-10 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const rowErrors = errors[row.id] ?? {};
                const qty = typeof row.requestedQuantity === "number" ? row.requestedQuantity : 0;
                const price = typeof row.unitPrice === "number" ? row.unitPrice : 0;
                const shortfall =
                  row.warehouseBalance !== null && qty > row.warehouseBalance;
                return (
                  <tr key={row.id} className="border-b border-border/60 align-top last:border-0">
                    <td className="px-4 py-3 text-text-muted">{idx + 1}</td>
                    <td className="px-3 py-3">
                      <MaterialCombobox
                        value={row.materialName}
                        onSelect={(m) => onMaterialSelect(row.id, m)}
                        onManualChange={(name) =>
                          updateRow(row.id, { materialName: name, materialId: null, warehouseBalance: null })
                        }
                      />
                      {rowErrors.materialName && <FieldError>{rowErrors.materialName}</FieldError>}
                    </td>
                    <td className="px-3 py-3 text-text-muted">
                      {row.warehouseBalance !== null ? (
                        <span className={shortfall ? "font-medium text-warning" : ""}>
                          {formatNumber(row.warehouseBalance)}
                        </span>
                      ) : (
                        <span className="text-text-muted/60">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <input
                        value={row.unit}
                        onChange={(e) => updateRow(row.id, { unit: e.target.value })}
                        placeholder="тн, м³..."
                        className="focus-ring h-9 w-full rounded-lg border border-border bg-bg-elevated px-2 text-sm text-text placeholder:text-text-muted"
                      />
                      {rowErrors.unit && <FieldError>{rowErrors.unit}</FieldError>}
                    </td>
                    <td className="px-3 py-3">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={row.requestedQuantity}
                        onChange={(e) =>
                          updateRow(row.id, {
                            requestedQuantity: e.target.value === "" ? "" : Number(e.target.value),
                          })
                        }
                        className="focus-ring h-9 w-full rounded-lg border border-border bg-bg-elevated px-2 text-sm text-text"
                      />
                      {rowErrors.requestedQuantity && <FieldError>{rowErrors.requestedQuantity}</FieldError>}
                    </td>
                    <td className="px-3 py-3">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={row.unitPrice}
                        onChange={(e) =>
                          updateRow(row.id, { unitPrice: e.target.value === "" ? "" : Number(e.target.value) })
                        }
                        className="focus-ring h-9 w-full rounded-lg border border-border bg-bg-elevated px-2 text-sm text-text"
                      />
                      {rowErrors.unitPrice && <FieldError>{rowErrors.unitPrice}</FieldError>}
                    </td>
                    <td className="px-3 py-3 font-medium text-text">{formatCurrency(qty * price)}</td>
                    <td className="px-3 py-3">
                      <input
                        value={row.note}
                        onChange={(e) => updateRow(row.id, { note: e.target.value })}
                        className="focus-ring h-9 w-full rounded-lg border border-border bg-bg-elevated px-2 text-sm text-text"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => removeRow(row.id)}
                        disabled={rows.length === 1}
                        className="focus-ring rounded text-text-muted hover:text-danger disabled:opacity-30"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6} className="px-3 py-3 text-right text-sm font-medium text-text-muted">
                  Нийт дүн
                </td>
                <td colSpan={3} className="px-3 py-3 text-base font-semibold text-text">
                  {formatCurrency(total)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Хавсралт</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              setAttachments((prev) => [...prev, ...files]);
              markDirty();
              e.target.value = "";
            }}
          />
          <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
            <Paperclip className="size-3.5" />
            Файл хавсаргах
          </Button>
          {attachments.length > 0 && (
            <ul className="space-y-1.5">
              {attachments.map((f, i) => (
                <li
                  key={`${f.name}-${i}`}
                  className="flex items-center justify-between rounded-lg border border-border bg-bg-elevated/50 px-3 py-2 text-xs"
                >
                  <span className="truncate text-text">{f.name}</span>
                  <button
                    onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                    className="focus-ring text-text-muted hover:text-danger"
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-bg-surface p-4">
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <AlertCircle className="size-3.5" />
          Илгээхийн өмнө бүх мөрийг шалгана уу. Илгээсний дараа цехийн дарга баталгаажуулна.
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={saveDraft}>
            <Save className="size-4" />
            Ноорог хадгалах
          </Button>
          <Button onClick={submit}>
            <Send className="size-4" />
            Илгээх
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-text-muted">{label}</span>
      {children}
    </label>
  );
}

function FieldError({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-[11px] text-danger">{children}</p>;
}
