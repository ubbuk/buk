"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { ftOrderSchema } from "@/lib/foreign-trade-validation";
import { FilePicker } from "./AttachmentList";
import { checkFilesClient, ftApi, inputClass, textareaClass } from "./api";

interface Row {
  key: number;
  name: string;
  techSpec: string;
  quantity: string;
  unit: string;
}

export interface ForeignTradeFormInitial {
  id: string;
  version: number;
  purpose: string;
  items: { name: string; techSpec: string | null; quantity: number; unit: string }[];
}

const UNITS = ["ш", "сет", "кг", "тонн", "м", "м²", "м³", "л", "хайрцаг"];
let nextKey = 1;
const blankRow = (): Row => ({ key: nextKey++, name: "", techSpec: "", quantity: "", unit: "ш" });

/** Create (BOSS) or edit (DRAFT / RETURNED_TO_BOSS) a foreign trade order. Submitting sends it to the MANAGER. */
export function ForeignTradeForm({ initial }: { initial?: ForeignTradeFormInitial }) {
  const router = useRouter();
  const toast = useToast();
  const [purpose, setPurpose] = useState(initial?.purpose ?? "");
  const [rows, setRows] = useState<Row[]>(
    initial?.items.length ? initial.items.map((i) => ({ key: nextKey++, name: i.name, techSpec: i.techSpec ?? "", quantity: String(i.quantity), unit: i.unit })) : [blankRow()]
  );
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<"draft" | "submit" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setRow = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function save(submit: boolean) {
    setError(null);
    const parsed = ftOrderSchema.safeParse({
      purpose,
      items: rows.map((r) => ({ name: r.name, techSpec: r.techSpec, quantity: Number(r.quantity.replace(",", ".")), unit: r.unit })),
    });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Хүчингүй өгөгдөл");
    const fileError = checkFilesClient(files);
    if (fileError) return setError(fileError);

    setBusy(submit ? "submit" : "draft");
    // Always saved as a draft first: files can only be attached while the order is still the BOSS's, and a failure on the
    // way must not leave a half-sent order with the MANAGER.
    let id = initial?.id;
    let version = initial?.version ?? 1;
    if (initial) {
      const r = await ftApi<{ version: number }>(`/api/foreign-trade/${initial.id}`, { method: "PATCH", json: { ...parsed.data, expectedVersion: initial.version } });
      if (!r.ok) {
        setBusy(null);
        return setError(r.error);
      }
      version = r.data.version;
    } else {
      const r = await ftApi<{ id: string }>("/api/foreign-trade", { json: { ...parsed.data, submit: false } });
      if (!r.ok) {
        setBusy(null);
        return setError(r.error);
      }
      id = r.data.id;
    }
    if (files.length) {
      const form = new FormData();
      files.forEach((f) => form.append("files", f));
      const up = await ftApi(`/api/foreign-trade/${id}/attachments`, { form });
      if (!up.ok) {
        setBusy(null);
        toast.push({ kind: "warning", title: "Захиалга хадгалагдсан боловч файл хавсаргаж чадсангүй", description: up.error });
        return router.replace(`/foreign-trade/${id}`);
      }
    }
    if (submit) {
      const sub = await ftApi(`/api/foreign-trade/${id}/submit`, { json: { expectedVersion: version } });
      if (!sub.ok) {
        setBusy(null);
        toast.push({ kind: "warning", title: "Захиалга хадгалагдсан боловч илгээж чадсангүй", description: sub.error });
        return router.replace(`/foreign-trade/${id}`);
      }
      toast.push({ kind: "success", title: "Захиалга MANAGER руу илгээгдлээ" });
    } else {
      toast.push({ kind: "success", title: "Ноорог хадгалагдлаа" });
    }
    router.replace(`/foreign-trade/${id}`);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-text">{initial ? "Гадаад худалдааны захиалга засах" : "Шинэ гадаад худалдааны захиалга"}</h2>
        <p className="text-sm text-text-muted">Барааны мэдээлэл, техникийн шаардлагыг оруулаад MANAGER руу илгээнэ үү. Үнийн судалгааг MANAGER хийнэ.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Хэрэгцээний тайлбар</CardTitle>
        </CardHeader>
        <CardBody>
          <textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={3} maxLength={4000} placeholder="Яагаад энэ бараа хэрэгтэй вэ?" className={textareaClass} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Бараа</CardTitle>
          <Button size="sm" variant="secondary" onClick={() => setRows((rs) => [...rs, blankRow()])}>
            <Plus className="size-4" /> Бараа нэмэх
          </Button>
        </CardHeader>
        <CardBody className="space-y-4">
          {rows.map((r, i) => (
            <div key={r.key} className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-text-muted">№{i + 1}</span>
                {rows.length > 1 && (
                  <button type="button" aria-label="Мөр устгах" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="focus-ring inline-flex size-9 items-center justify-center rounded-md text-danger hover:bg-danger/10">
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
              <input value={r.name} onChange={(e) => setRow(r.key, { name: e.target.value })} placeholder="Барааны нэр" maxLength={300} aria-label="Барааны нэр" className={inputClass} />
              <textarea value={r.techSpec} onChange={(e) => setRow(r.key, { techSpec: e.target.value })} rows={2} maxLength={4000} placeholder="Техникийн шаардлага" aria-label="Техникийн шаардлага" className={textareaClass} />
              <div className="grid grid-cols-2 gap-2">
                <input value={r.quantity} onChange={(e) => setRow(r.key, { quantity: e.target.value })} inputMode="decimal" placeholder="Тоо хэмжээ" aria-label="Тоо хэмжээ" className={inputClass} />
                <input value={r.unit} onChange={(e) => setRow(r.key, { unit: e.target.value })} list="ft-units" placeholder="Нэгж" aria-label="Нэгж" maxLength={30} className={inputClass} />
              </div>
            </div>
          ))}
          <datalist id="ft-units">
            {UNITS.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Хавсралт (зураг, PDF, Excel)</CardTitle>
        </CardHeader>
        <CardBody>
          <FilePicker files={files} onChange={setFiles} disabled={busy !== null} />
        </CardBody>
      </Card>

      {error && (
        <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={() => router.back()} disabled={busy !== null}>
          Болих
        </Button>
        <Button variant="secondary" loading={busy === "draft"} disabled={busy !== null} onClick={() => save(false)}>
          Ноорог хадгалах
        </Button>
        <Button loading={busy === "submit"} disabled={busy !== null} onClick={() => save(true)}>
          MANAGER руу илгээх
        </Button>
      </div>
    </div>
  );
}
