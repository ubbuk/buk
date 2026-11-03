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
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { useRequestStore } from "@/lib/store";
import { formatCurrency, formatDate, formatFileSize, formatNumber } from "@/lib/utils";
import { validateItem, type FieldErrors } from "@/lib/validation";
import {
  ALLOWED_ATTACHMENT_EXTENSIONS,
  ALLOWED_ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENTS_PER_REQUEST,
  MAX_ATTACHMENT_SIZE_BYTES,
} from "@/lib/attachment-rules";
import type { MaterialCatalogEntry, MaterialRequestView } from "@/lib/types";
import { MaterialCombobox } from "./MaterialCombobox";

interface DepartmentOption {
  id: string;
  name: string;
  type: "OFFICE" | "FACTORY";
}

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
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [departmentId, setDepartmentId] = useState("");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [urgent, setUrgent] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, FieldErrors>>({});
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [materials, setMaterials] = useState<MaterialCatalogEntry[]>([]);
  const [submitted, setSubmitted] = useState<{
    id: string;
    requestNumber: string;
    nextApprover: string;
    attachmentWarning?: string;
  } | null>(null);
  const createRequest = useRequestStore((s) => s.createRequest);
  const resubmitDepartment = useRequestStore((s) => s.resubmitDepartment);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const restoredRef = useRef(false);
  const draftFoundRef = useRef(false);
  const prefilledRef = useRef(false);

  const editRequestId = searchParams.get("editRequestId");
  const isEditMode = !!editRequestId;
  const [editRequest, setEditRequest] = useState<MaterialRequestView | null>(null);
  const editHydratedRef = useRef(false);

  useEffect(() => {
    if (!editRequestId) return;
    fetch(`/api/requests/${editRequestId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: MaterialRequestView | null) => {
        if (!data) return;
        setEditRequest(data);
        if (editHydratedRef.current) return;
        editHydratedRef.current = true;
        setDepartmentId(data.departmentId);
        setNote(data.note ?? "");
        setRows(
          data.items.map((item) => ({
            id: crypto.randomUUID(),
            materialId: item.materialId,
            materialName: item.materialName,
            warehouseBalance: item.warehouseBalance,
            unit: item.unit,
            requestedQuantity: item.requestedQuantity,
            unitPrice: item.unitPrice ?? "",
            note: item.note ?? "",
          }))
        );
      })
      .catch(() => setEditRequest(null));
  }, [editRequestId]);

  useEffect(() => {
    fetch("/api/materials")
      .then((res) => (res.ok ? res.json() : []))
      .then((data: MaterialCatalogEntry[]) => setMaterials(data))
      .catch(() => setMaterials([]));
  }, []);

  useEffect(() => {
    fetch("/api/departments")
      .then((res) => (res.ok ? res.json() : []))
      .then((data: DepartmentOption[]) => setDepartments(data))
      .catch(() => setDepartments([]));
  }, []);

  useEffect(() => {
    if (departmentId || departments.length === 0) return;
    setDepartmentId(session?.user?.departmentId || departments[0].id);
  }, [departments, session, departmentId]);

  useEffect(() => {
    if (restoredRef.current || isEditMode) return;
    restoredRef.current = true;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw);
        if (draft.rows?.length) setRows(draft.rows);
        if (draft.departmentId) setDepartmentId(draft.departmentId);
        if (draft.note) setNote(draft.note);
        draftFoundRef.current = true;
        push({ kind: "info", title: "Хадгалсан ноорог сэргээгдлээ" });
      }
    } catch {
      // corrupted draft — ignore and start fresh
    }

    if (searchParams.get("urgent") === "1") {
      setUrgent(true);
      setNote((prev) => prev || "Яаралтай шаардлагатай — агуулахын нөөц хүрэлцэхгүй байна");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Prefilling a material (from the dashboard's "Яаралтай захиалга" button)
  // needs the real catalog loaded first, so this waits on `materials`.
  useEffect(() => {
    if (prefilledRef.current || draftFoundRef.current || materials.length === 0 || isEditMode) return;
    prefilledRef.current = true;
    const materialId = searchParams.get("material");
    if (!materialId) return;
    const material = materials.find((m) => m.id === materialId);
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
  }, [materials, searchParams, isEditMode]);

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

  // null (not 0) whenever any row has no price yet — the real total is
  // unknown until every row is priced, not zero for the missing rows.
  const total = useMemo<number | null>(() => {
    if (rows.some((r) => typeof r.unitPrice !== "number")) return null;
    return rows.reduce((sum, r) => {
      const qty = typeof r.requestedQuantity === "number" ? r.requestedQuantity : 0;
      return sum + qty * (r.unitPrice as number);
    }, 0);
  }, [rows]);

  function saveDraft() {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ rows, departmentId, note, savedAt: new Date().toISOString() })
    );
    setDirty(false);
    push({ kind: "success", title: "Ноорог хадгалагдлаа", description: "Та дараа нэвтрэхдээ үргэлжлүүлэх боломжтой" });
  }

  function onFilesSelected(selected: File[]) {
    const existingCount = (isEditMode ? editRequest?.attachments.length ?? 0 : 0) + attachments.length;
    const accepted: File[] = [];
    for (const file of selected) {
      if (existingCount + accepted.length >= MAX_ATTACHMENTS_PER_REQUEST) {
        push({
          kind: "error",
          title: "Хэт олон файл",
          description: `Нэг захиалгад хамгийн ихдээ ${MAX_ATTACHMENTS_PER_REQUEST} файл хавсаргах боломжтой`,
        });
        break;
      }
      if (!ALLOWED_ATTACHMENT_MIME_TYPES.includes(file.type as (typeof ALLOWED_ATTACHMENT_MIME_TYPES)[number])) {
        push({ kind: "error", title: "Дэмжигдэхгүй файлын төрөл", description: `${file.name} — JPG, PNG, WEBP, PDF, XLSX, DOCX файл дэмжинэ` });
        continue;
      }
      if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
        push({ kind: "error", title: "Файл хэт том байна", description: `${file.name} — 10 MB-с ихгүй байх ёстой` });
        continue;
      }
      accepted.push(file);
    }
    if (accepted.length > 0) {
      setAttachments((prev) => [...prev, ...accepted]);
      markDirty();
    }
  }

  // Uploaded only after the request itself is successfully created/resubmitted
  // -- a failed upload never loses the already-saved request data, it just
  // returns a warning the success screen surfaces so the user knows to
  // retry from the request's detail page.
  async function uploadAttachments(requestId: string): Promise<string | null> {
    if (attachments.length === 0) return null;
    const formData = new FormData();
    for (const file of attachments) formData.append("files", file);
    try {
      const res = await fetch(`/api/requests/${requestId}/attachments`, { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return body.error || "Файл хавсаргахад алдаа гарлаа";
      }
      return null;
    } catch {
      return "Файл хавсаргахад алдаа гарлаа. Сүлжээгээ шалгаад Дэлгэрэнгүй хуудаснаас дахин оролдоно уу";
    }
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
        // An empty price field means "not entered" (valid) -- only an
        // actually-typed invalid value (e.g. negative) should fail
        // validation, so this passes null rather than NaN.
        unitPrice: typeof row.unitPrice === "number" ? row.unitPrice : null,
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

  async function submit() {
    if (!validateAll()) {
      push({ kind: "error", title: "Маягтад алдаа байна", description: "Улаанаар тэмдэглэгдсэн талбаруудыг засна уу" });
      return;
    }
    if (!session?.user?.name) {
      push({ kind: "error", title: "Нэвтрэх шаардлагатай" });
      return;
    }

    setSubmitting(true);
    try {
      if (isEditMode && editRequest) {
        await resubmitDepartment(
          editRequest.id,
          session.user.name,
          editRequest.version,
          rows.map((r) => ({
            materialId: r.materialId,
            materialName: r.materialName,
            unit: r.unit,
            requestedQuantity: typeof r.requestedQuantity === "number" ? r.requestedQuantity : 0,
            unitPrice: typeof r.unitPrice === "number" ? r.unitPrice : null,
            warehouseBalance: r.warehouseBalance,
            note: r.note || undefined,
          })),
          note || undefined
        );
        const attachmentWarning = await uploadAttachments(editRequest.id);
        setDirty(false);
        setSubmitted({
          id: editRequest.id,
          requestNumber: editRequest.requestNumber,
          nextApprover: editRequest.approvalSteps.find((s) => s.type === "DEPARTMENT_HEAD")?.assignedUserName ?? "—",
          attachmentWarning: attachmentWarning ?? undefined,
        });
        return;
      }

      const newRequest = await createRequest({
        departmentId,
        requestedBy: session.user.name,
        items: rows.map((r) => ({
          materialId: r.materialId,
          materialName: r.materialName,
          unit: r.unit,
          requestedQuantity: typeof r.requestedQuantity === "number" ? r.requestedQuantity : 0,
          unitPrice: typeof r.unitPrice === "number" ? r.unitPrice : null,
          warehouseBalance: r.warehouseBalance,
          note: r.note || undefined,
        })),
      });
      const attachmentWarning = await uploadAttachments(newRequest.id);
      localStorage.removeItem(DRAFT_KEY);
      setDirty(false);
      setSubmitted({
        id: newRequest.id,
        requestNumber: newRequest.requestNumber,
        nextApprover: newRequest.approvalSteps[0].assignedUserName,
        attachmentWarning: attachmentWarning ?? undefined,
      });
    } catch (err) {
      push({
        kind: "error",
        title: isEditMode ? "Дахин илгээхэд алдаа гарлаа" : "Захиалга илгээхэд алдаа гарлаа",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setRows([emptyRow()]);
    setDepartmentId(session?.user?.departmentId || departments[0]?.id || "");
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
            <p className="text-lg font-semibold text-text">
              {isEditMode ? "Захиалгыг амжилттай дахин илгээлээ" : "Захиалга амжилттай илгээгдлээ"}
            </p>
            <p className="mt-1 text-sm text-text-muted">
              Захиалгын дугаар <span className="font-medium text-text">№{submitted.requestNumber}</span>
            </p>
          </div>
          <div className="w-full rounded-lg border border-border bg-bg-elevated/50 p-3 text-sm">
            <p className="text-text-muted">Дараагийн баталгаажуулагч</p>
            <p className="mt-0.5 font-medium text-text">{submitted.nextApprover}</p>
          </div>
          {submitted.attachmentWarning && (
            <div className="w-full rounded-lg border border-warning/30 bg-warning/10 p-3 text-left text-xs text-warning">
              Захиалга хадгалагдсан боловч файл хавсаргахад алдаа гарлаа: {submitted.attachmentWarning}. Дэлгэрэнгүй хуудаснаас дахин оролдоно уу.
            </div>
          )}
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
            <CardTitle>{isEditMode ? "Захиалгыг засварлаж дахин илгээх" : "Маягт №1 — Материалын захиалгын хуудас"}</CardTitle>
            {urgent && (
              <span className="inline-flex items-center gap-1 rounded-full border border-danger/30 bg-danger/10 px-2.5 py-1 text-[11px] font-medium text-danger">
                Яаралтай
              </span>
            )}
          </div>
          <span className="text-xs text-text-muted">
            Огноо: <span suppressHydrationWarning>{formatDate(new Date())}</span>
          </span>
        </CardHeader>
        <CardBody>
          <div className="max-w-xs">
            <Field label="Захиалгын чиглэл">
              <div className="flex h-9 items-center rounded-lg border border-border bg-bg-elevated px-3 text-sm text-text-muted">
                {departments.find((d) => d.id === departmentId)?.type === "OFFICE" ? "Оффис" : "Үйлдвэр"}
                <span className="ml-1.5 text-xs text-text-muted/70">(цехийн ангиллаар автоматаар тодорхойлогдоно)</span>
              </div>
            </Field>
          </div>
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
          <table className="w-full min-w-[1080px] border-collapse text-base">
            <thead>
              <tr className="border-b border-border text-left text-sm text-text-muted">
                <th className="w-12 px-4 py-3.5 font-medium">№</th>
                <th className="min-w-[360px] px-3 py-3.5 text-base font-semibold text-text">Захиалах сэлбэг, материалын нэр</th>
                <th className="w-32 px-3 py-3.5 font-medium">Агуулахын үлдэгдэл</th>
                <th className="w-24 px-3 py-3.5 font-medium">Хэмжих нэгж</th>
                <th className="w-28 px-3 py-3.5 font-medium">Тоо</th>
                <th className="w-32 px-3 py-3.5 font-medium">Нэгж үнэ</th>
                <th className="w-32 px-3 py-3.5 font-medium">Бүгд үнэ</th>
                <th className="min-w-[160px] px-3 py-3.5 font-medium">Тайлбар</th>
                <th className="w-10 px-3 py-3.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const rowErrors = errors[row.id] ?? {};
                const qty = typeof row.requestedQuantity === "number" ? row.requestedQuantity : 0;
                const price = typeof row.unitPrice === "number" ? row.unitPrice : null;
                const shortfall =
                  row.warehouseBalance !== null && qty > row.warehouseBalance;
                return (
                  <tr key={row.id} className="border-b border-border/60 align-top last:border-0">
                    <td className="px-4 py-4 text-text-muted">{idx + 1}</td>
                    <td className="px-3 py-4">
                      <MaterialCombobox
                        value={row.materialName}
                        materials={materials}
                        onSelect={(m) => onMaterialSelect(row.id, m)}
                        onManualChange={(name) =>
                          updateRow(row.id, { materialName: name, materialId: null, warehouseBalance: null })
                        }
                      />
                      {rowErrors.materialName && <FieldError>{rowErrors.materialName}</FieldError>}
                    </td>
                    <td className="px-3 py-4 text-text-muted">
                      {row.warehouseBalance !== null ? (
                        <span className={shortfall ? "font-medium text-warning" : ""}>
                          {formatNumber(row.warehouseBalance)}
                        </span>
                      ) : (
                        <span className="text-text-muted/60">—</span>
                      )}
                    </td>
                    <td className="px-3 py-4">
                      <input
                        value={row.unit}
                        onChange={(e) => updateRow(row.id, { unit: e.target.value })}
                        placeholder="тн, м³..."
                        className="focus-ring h-11 w-full rounded-lg border border-border bg-bg-elevated px-2.5 text-base text-text placeholder:text-text-muted"
                      />
                      {rowErrors.unit && <FieldError>{rowErrors.unit}</FieldError>}
                    </td>
                    <td className="px-3 py-4">
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
                        className="focus-ring h-11 w-full rounded-lg border border-border bg-bg-elevated px-2.5 text-base text-text"
                      />
                      {rowErrors.requestedQuantity && <FieldError>{rowErrors.requestedQuantity}</FieldError>}
                    </td>
                    <td className="px-3 py-4">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={row.unitPrice}
                        placeholder="Заавал биш"
                        onChange={(e) =>
                          updateRow(row.id, { unitPrice: e.target.value === "" ? "" : Number(e.target.value) })
                        }
                        className="focus-ring h-11 w-full rounded-lg border border-border bg-bg-elevated px-2.5 text-base text-text placeholder:text-text-muted"
                      />
                      {rowErrors.unitPrice && <FieldError>{rowErrors.unitPrice}</FieldError>}
                    </td>
                    <td className="px-3 py-4 font-medium text-text">
                      {formatCurrency(price === null ? null : qty * price)}
                    </td>
                    <td className="px-3 py-4">
                      <input
                        value={row.note}
                        onChange={(e) => updateRow(row.id, { note: e.target.value })}
                        className="focus-ring h-11 w-full rounded-lg border border-border bg-bg-elevated px-2.5 text-base text-text"
                      />
                    </td>
                    <td className="px-3 py-4">
                      <button
                        type="button"
                        onClick={() => removeRow(row.id)}
                        disabled={rows.length === 1}
                        className="focus-ring rounded text-text-muted hover:text-danger disabled:opacity-30"
                      >
                        <Trash2 className="size-5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6} className="px-3 py-4 text-right text-base font-medium text-text-muted">
                  Нийт дүн
                </td>
                <td colSpan={3} className="px-3 py-4 text-lg font-semibold text-text">
                  {formatCurrency(total)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Хавсралт (заавал биш)</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-xs text-text-muted">
            JPG, PNG, WEBP, PDF, XLSX, DOCX · файл тус бүр 10 MB хүртэл · нэг захиалгад {MAX_ATTACHMENTS_PER_REQUEST} файл хүртэл
          </p>

          {isEditMode && editRequest && editRequest.attachments.length > 0 && (
            <ul className="space-y-1.5">
              {editRequest.attachments.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between rounded-lg border border-border bg-bg-elevated/50 px-3 py-2 text-xs"
                >
                  <a
                    href={`/api/requests/${editRequest.id}/attachments/${a.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="focus-ring truncate text-text underline decoration-dotted hover:text-accent"
                  >
                    {a.fileName}
                  </a>
                  <span className="shrink-0 text-text-muted">{formatFileSize(a.sizeBytes)}</span>
                </li>
              ))}
            </ul>
          )}

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ALLOWED_ATTACHMENT_EXTENSIONS}
            className="hidden"
            onChange={(e) => {
              onFilesSelected(Array.from(e.target.files ?? []));
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
                  <span className="truncate text-text">
                    {f.name} <span className="text-text-muted">({formatFileSize(f.size)})</span>
                  </span>
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
          {!isEditMode && (
            <Button variant="secondary" onClick={saveDraft}>
              <Save className="size-4" />
              Ноорог хадгалах
            </Button>
          )}
          <Button onClick={submit} loading={submitting} disabled={submitting}>
            <Send className="size-4" />
            {isEditMode ? "Дахин илгээх" : "Илгээх"}
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
