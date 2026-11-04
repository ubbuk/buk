"use client";

import {
  Boxes,
  CheckCircle2,
  Info,
  Loader2,
  Paperclip,
  Plus,
  Save,
  Send,
  Trash2,
  Warehouse,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { useRequestStore } from "@/lib/store";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import { validateItem, type FieldErrors } from "@/lib/validation";
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENTS_PER_REQUEST,
  MAX_ATTACHMENT_SIZE_BYTES,
} from "@/lib/attachment-rules";
import type { MaterialCatalogEntry, MaterialRequestView } from "@/lib/types";
import { MaterialCombobox } from "./MaterialCombobox";
import { AttachmentDropzone } from "./hud/AttachmentDropzone";
import { HudHeader } from "./hud/HudHeader";
import { HudPanel } from "./hud/HudPanel";
import { OrderTelemetry } from "./hud/OrderTelemetry";
import { WorkflowStrip, type StepState } from "./hud/WorkflowStrip";
import "./hud/hud.css";

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

  // --- HUD view-model: everything below is derived from the form state above ---
  const isOffice = departments.find((d) => d.id === departmentId)?.type === "OFFICE";
  const materialCount = rows.filter((r) => r.materialName.trim()).length;
  const totalQty = rows.reduce((sum, r) => sum + (typeof r.requestedQuantity === "number" ? r.requestedQuantity : 0), 0);
  const touched = rows.some((r) => r.materialName.trim() || r.unit.trim() || r.requestedQuantity !== "");
  const rowsComplete = rows.every(
    (r) => r.materialName.trim() && r.unit.trim() && typeof r.requestedQuantity === "number" && r.requestedQuantity > 0
  );
  const filledFields = rows.reduce(
    (sum, r) =>
      sum +
      (r.materialName.trim() ? 1 : 0) +
      (r.unit.trim() ? 1 : 0) +
      (typeof r.requestedQuantity === "number" && r.requestedQuantity > 0 ? 1 : 0),
    0
  );
  const progress = Math.round((filledFields / (rows.length * 3)) * 100);
  const existingAttachmentCount = isEditMode ? editRequest?.attachments.length ?? 0 : 0;
  const hasAttachments = attachments.length + existingAttachmentCount > 0;
  const stepStates: [StepState, StepState, StepState, StepState] = [
    touched ? "done" : "active",
    !touched ? "todo" : rowsComplete ? "done" : "active",
    hasAttachments ? "done" : "todo",
    touched && rowsComplete ? "active" : "todo",
  ];

  return (
    <div className="hud-form -mx-4 -mt-4 min-h-[calc(100vh-4rem)] max-w-[100vw] space-y-4 overflow-x-clip px-4 pb-6 pt-4 sm:-mx-6 sm:px-6">
      <HudHeader
        title={isEditMode ? "Захиалгыг засварлаж дахин илгээх" : "Шинэ материалын захиалга"}
        subtitle="Маягт №1 — Материалын захиалгын хуудас"
        dateLabel={formatDate(new Date())}
        statusLabel={isEditMode ? "Засвар" : "Ноорог"}
        urgent={urgent}
      />

      <WorkflowStrip states={stepStates} />

      <OrderTelemetry
        directionLabel={isOffice ? "Оффис" : "Үйлдвэр"}
        isOffice={!!isOffice}
        materialCount={materialCount}
        totalQuantity={new Intl.NumberFormat("mn-MN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(totalQty)}
        totalPriceLabel={formatCurrency(total)}
        priceKnown={total !== null}
        progress={progress}
      />

      <HudPanel chamfer={16} innerClassName="pb-2">
        <div className="flex items-center justify-between gap-3 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-lg border border-accent/50 bg-accent/10 text-accent">
              <Boxes className="size-5" />
            </span>
            <h2 className="text-lg font-semibold text-text">Захиалах материал</h2>
          </div>
          <span className="hud-glow">
            <button type="button" onClick={addRow} className="hud-btn hud-btn--outline-amber">
              <Plus className="size-4" />
              Мөр нэмэх
            </button>
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="hud-table w-full min-w-[1200px] border-collapse text-base">
            <thead>
              <tr className="border-y border-tech/25 bg-tech/[0.04] text-left text-sm text-text-muted">
                <th className="w-14 px-3 py-3 font-medium">№</th>
                <th className="min-w-[300px] px-2 py-3 text-base font-semibold text-text">
                  Захиалах сэлбэг, материалын нэр <span className="text-accent">*</span>
                </th>
                <th className="w-[8.5rem] px-2 py-3 font-medium">Агуулахын үлдэгдэл</th>
                <th className="w-32 px-2 py-3 font-medium">Хэмжих нэгж</th>
                <th className="w-36 px-2 py-3 font-medium">
                  Тоо хэмжээ <span className="text-accent">*</span>
                </th>
                <th className="w-40 px-2 py-3 font-medium">Нэгж үнэ</th>
                <th className="w-36 px-2 py-3 font-medium">Бүгд үнэ</th>
                <th className="min-w-[200px] px-2 py-3 font-medium">Тайлбар</th>
                <th className="w-14 px-2 py-3">
                  <span className="sr-only">Устгах</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const rowErrors = errors[row.id] ?? {};
                const qty = typeof row.requestedQuantity === "number" ? row.requestedQuantity : 0;
                const price = typeof row.unitPrice === "number" ? row.unitPrice : null;
                const shortfall = row.warehouseBalance !== null && qty > row.warehouseBalance;
                return (
                  <tr key={row.id} className="hud-row align-top">
                    <td className="px-3 py-3.5">
                      <span className="flex size-9 items-center justify-center rounded-md border border-tech/30 bg-bg/60 text-sm font-semibold tabular-nums text-text">
                        {idx + 1}
                      </span>
                    </td>
                    <td className="px-2 py-3.5">
                      <MaterialCombobox
                        value={row.materialName}
                        materials={materials}
                        invalid={!!rowErrors.materialName}
                        onSelect={(m) => onMaterialSelect(row.id, m)}
                        onManualChange={(name) =>
                          updateRow(row.id, { materialName: name, materialId: null, warehouseBalance: null })
                        }
                      />
                      {rowErrors.materialName && <FieldError>{rowErrors.materialName}</FieldError>}
                    </td>
                    <td className="px-2 py-3.5">
                      <div
                        className={`flex h-11 items-center justify-center gap-1.5 rounded-lg border px-2 text-sm tabular-nums ${
                          shortfall
                            ? "border-warning/60 bg-warning/10 font-semibold text-warning"
                            : "border-tech/20 bg-bg/60 text-text-muted"
                        }`}
                        title={shortfall ? "Агуулахын үлдэгдэл хүрэлцэхгүй" : undefined}
                      >
                        {row.warehouseBalance !== null ? (
                          <>
                            <Warehouse className="size-3.5" />
                            {formatNumber(row.warehouseBalance)}
                          </>
                        ) : (
                          "—"
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-3.5">
                      <input
                        value={row.unit}
                        list="hud-units"
                        aria-label="Хэмжих нэгж"
                        aria-invalid={!!rowErrors.unit || undefined}
                        onChange={(e) => updateRow(row.id, { unit: e.target.value })}
                        placeholder="тн, м³..."
                        className="hud-input"
                      />
                      {rowErrors.unit && <FieldError>{rowErrors.unit}</FieldError>}
                    </td>
                    <td className="px-2 py-3.5">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        aria-label="Тоо хэмжээ"
                        aria-invalid={!!rowErrors.requestedQuantity || undefined}
                        placeholder="0.00"
                        value={row.requestedQuantity}
                        onChange={(e) =>
                          updateRow(row.id, {
                            requestedQuantity: e.target.value === "" ? "" : Number(e.target.value),
                          })
                        }
                        className="hud-input"
                      />
                      {rowErrors.requestedQuantity && <FieldError>{rowErrors.requestedQuantity}</FieldError>}
                    </td>
                    <td className="px-2 py-3.5">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        aria-label="Нэгж үнэ"
                        aria-invalid={!!rowErrors.unitPrice || undefined}
                        value={row.unitPrice}
                        placeholder="Заавал биш"
                        onChange={(e) =>
                          updateRow(row.id, { unitPrice: e.target.value === "" ? "" : Number(e.target.value) })
                        }
                        className="hud-input"
                      />
                      {rowErrors.unitPrice && <FieldError>{rowErrors.unitPrice}</FieldError>}
                    </td>
                    <td className="px-2 py-3.5">
                      <div
                        className={`flex h-11 items-center text-base font-semibold tabular-nums ${
                          price === null ? "text-accent" : "text-text"
                        }`}
                      >
                        {formatCurrency(price === null ? null : qty * price)}
                      </div>
                    </td>
                    <td className="px-2 py-3.5">
                      <input
                        value={row.note}
                        aria-label="Тайлбар"
                        placeholder="Тайлбар оруулах..."
                        onChange={(e) => updateRow(row.id, { note: e.target.value })}
                        className="hud-input"
                      />
                    </td>
                    <td className="px-2 py-3.5">
                      <button
                        type="button"
                        onClick={() => removeRow(row.id)}
                        disabled={rows.length === 1}
                        aria-label={`${idx + 1}-р мөрийг устгах`}
                        className="focus-ring flex size-11 items-center justify-center rounded-lg border border-danger/40 bg-danger/10 text-danger transition-colors hover:bg-danger/25 disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        <Trash2 className="size-5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <datalist id="hud-units">
            {["ш", "кг", "тн", "л", "м", "м²", "м³", "багц", "комплект"].map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </div>
        <div className="flex justify-end px-4 pb-2 pt-3 sm:px-5">
          <HudPanel tone="amber" chamfer={10} innerClassName="flex items-center gap-4 px-4 py-2 !bg-[linear-gradient(160deg,rgba(78,50,5,0.85),rgba(26,17,5,0.95))]">
            <span className="text-sm font-medium text-text-muted">Нийт дүн</span>
            <span
              className={`text-xl font-bold tabular-nums ${total === null ? "text-accent" : "text-text"} [text-shadow:0_0_14px_rgba(255,170,0,0.55)]`}
            >
              {formatCurrency(total)}
            </span>
          </HudPanel>
        </div>
      </HudPanel>

      <section aria-labelledby="hud-attach-title" className="space-y-2">
        <h2 id="hud-attach-title" className="flex items-center gap-2 text-lg font-semibold text-text">
          <Paperclip className="size-5 text-accent" />
          Хавсралт <span className="text-sm font-normal text-text-muted">(заавал биш)</span>
        </h2>
        <AttachmentDropzone
          files={attachments}
          existing={
            isEditMode && editRequest
              ? editRequest.attachments.map((a) => ({
                  id: a.id,
                  fileName: a.fileName,
                  sizeBytes: a.sizeBytes,
                  href: `/api/requests/${editRequest.id}/attachments/${a.id}`,
                }))
              : []
          }
          onSelect={onFilesSelected}
          onRemove={(i) => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
        />
      </section>

      <HudPanel chamfer={18} className="sticky bottom-20 z-30 md:bottom-3" innerClassName="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5 !bg-[linear-gradient(160deg,rgba(14,38,54,0.98),rgba(6,18,28,0.99))]">
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Info className="size-4 shrink-0 text-tech" />
          Илгээхийн өмнө бүх мөрийг шалгана уу. Илгээсний дараа цехийн дарга баталгаажуулна.
        </div>
        <div className="flex w-full flex-wrap gap-3 sm:w-auto">
          {!isEditMode && (
            <button type="button" onClick={saveDraft} className="hud-btn hud-btn--secondary">
              <Save className="size-4" />
              Ноорог хадгалах
            </button>
          )}
          <span className="hud-glow">
            <button type="button" onClick={submit} disabled={submitting} aria-busy={submitting} className="hud-btn hud-btn--primary min-w-[9.5rem]">
              {submitting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {isEditMode ? "Дахин илгээх" : "Илгээх"}
            </button>
          </span>
        </div>
      </HudPanel>
    </div>
  );
}

function FieldError({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-[11px] text-danger">{children}</p>;
}
