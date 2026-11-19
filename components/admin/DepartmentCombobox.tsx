"use client";

import { Check, ChevronDown, PenLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/Toast";

export interface DepartmentComboboxOption {
  id: string;
  name: string;
  type: "OFFICE" | "FACTORY";
}

export function DepartmentCombobox({
  value,
  departments,
  onSelect,
  onCreated,
  onDraftChange,
  fixedType,
}: {
  value: string | null;
  departments: DepartmentComboboxOption[];
  onSelect: (departmentId: string | null) => void;
  onCreated?: (department: DepartmentComboboxOption) => void;
  /** The text typed that is NOT (yet) a chosen department, or null. The form must refuse to save while it is set:
   *  typed-but-unchosen text used to be dropped silently and the user was told "saved". */
  onDraftChange?: (draft: string | null) => void;
  /** When set, a newly-typed department is created with this type directly — no Үйлдвэр/Оффис sub-step. */
  fixedType?: "OFFICE" | "FACTORY";
}) {
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [showTypePicker, setShowTypePicker] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const changedByTyping = useRef(false);

  const selected = departments.find((d) => d.id === value) ?? null;

  useEffect(() => {
    if (changedByTyping.current) {
      changedByTyping.current = false; // the value moved because of what is being typed: keep the text
      return;
    }
    setQuery(selected?.name ?? "");
    // Only reset the typed text when the *selected department* changes from
    // outside (e.g. modal reopened for a different user) — not on every
    // departments-list refresh, which would wipe what the admin is typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const draft = query.trim() && !selected ? query.trim() : null;
  useEffect(() => {
    onDraftChange?.(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);
  useEffect(() => () => onDraftChange?.(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowTypePicker(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const filtered = departments.filter((d) => d.name.toLowerCase().includes(query.trim().toLowerCase()));
  const exactMatch = departments.some((d) => d.name.toLowerCase() === query.trim().toLowerCase());
  const canOfferCreate = query.trim().length > 0 && !exactMatch;

  async function createDepartment(type: "OFFICE" | "FACTORY") {
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: query.trim(), type }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Цех, тасаг үүсгэж чадсангүй");
      const created: DepartmentComboboxOption = { id: body.id, name: body.name, type: body.type };
      onCreated?.(created);
      onSelect(created.id);
      setQuery(created.name);
      setOpen(false);
      setShowTypePicker(false);
    } catch (err) {
      push({ kind: "error", title: "Цех, тасаг үүсгэж чадсангүй", description: err instanceof Error ? err.message : undefined });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          value={query}
          onChange={(e) => {
            const text = e.target.value;
            setQuery(text);
            setShowTypePicker(false);
            setOpen(true);
            // typing the exact name of a department chooses it; anything else un-chooses the previous one,
            // so the text on screen and the saved value can never disagree
            const typed = text.trim().toLowerCase();
            const match = typed ? departments.find((d) => d.name.toLowerCase() === typed) : undefined;
            if (match) {
              if (match.id !== value) {
                changedByTyping.current = true;
                onSelect(match.id);
              }
            } else if (value !== null) {
              changedByTyping.current = true;
              onSelect(null);
            }
          }}
          onFocus={() => setOpen(true)}
          placeholder="Цех, тасаг хайх эсвэл шинээр бичих..."
          className="focus-ring h-9 w-full rounded-lg border border-border bg-bg-elevated px-3 pr-9 text-sm text-text placeholder:text-text-muted"
        />
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
      </div>
      {draft && !open && (
        <p role="alert" className="mt-1 text-xs text-danger">
          «{draft}» сонгогдоогүй байна. Жагсаалтаас сонгох эсвэл «шинээр нэмэх»-ийг дарна уу
        </p>
      )}

      {open && (
        <div className="absolute z-20 mt-1 max-h-72 w-full min-w-[260px] overflow-y-auto rounded-lg border border-border bg-bg-elevated shadow-elevated">
          <button
            type="button"
            onClick={() => {
              onSelect(null);
              setQuery("");
              setOpen(false);
              setShowTypePicker(false);
            }}
            className={cn(
              "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-text-muted hover:bg-bg-surface",
              value === null && "bg-bg-surface"
            )}
          >
            Цех, тасаггүй
            {value === null && <Check className="size-3.5 shrink-0 text-accent" />}
          </button>

          {filtered.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => {
                onSelect(d.id);
                setQuery(d.name);
                setOpen(false);
                setShowTypePicker(false);
              }}
              className={cn(
                "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-bg-surface",
                d.id === value && "bg-bg-surface"
              )}
            >
              <span className="truncate text-text">{d.name}</span>
              <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-text-muted">
                {d.type === "FACTORY" ? "Үйлдвэр" : "Оффис"}
                {d.id === value && <Check className="size-3.5 text-accent" />}
              </span>
            </button>
          ))}

          {canOfferCreate && (
            <div className="border-t border-border px-3 py-2.5">
              {fixedType ? (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => createDepartment(fixedType)}
                  className="flex w-full items-center gap-2 text-left text-sm text-accent hover:underline disabled:opacity-60"
                >
                  <PenLine className="size-4 shrink-0" />
                  &quot;{query.trim()}&quot; гэж {fixedType === "FACTORY" ? "үйлдвэрийн" : "оффисын"} цех/тасаг шинээр нэмэх
                </button>
              ) : !showTypePicker ? (
                <button
                  type="button"
                  onClick={() => setShowTypePicker(true)}
                  className="flex w-full items-center gap-2 text-left text-sm text-accent hover:underline"
                >
                  <PenLine className="size-4 shrink-0" />
                  &quot;{query.trim()}&quot; гэж шинээр нэмэх
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-text-muted">&quot;{query.trim()}&quot; ямар төрлийн цех/тасаг вэ?</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => createDepartment("FACTORY")}
                      className="focus-ring h-8 flex-1 rounded-lg border border-border bg-bg-surface text-xs font-medium text-text hover:border-accent/50 disabled:opacity-60"
                    >
                      Үйлдвэр
                    </button>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => createDepartment("OFFICE")}
                      className="focus-ring h-8 flex-1 rounded-lg border border-border bg-bg-surface text-xs font-medium text-text hover:border-accent/50 disabled:opacity-60"
                    >
                      Оффис
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
