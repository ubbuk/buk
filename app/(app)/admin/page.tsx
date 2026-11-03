"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Check, Copy, FileClock, KeyRound, Plus, RotateCcw, ShieldCheck, UserCog } from "lucide-react";
import { DepartmentCombobox } from "@/components/admin/DepartmentCombobox";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { ROLE_PERMISSION_SUMMARY, USER_ROLE_LABEL, USER_ROLES } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";

// Each singleton position's holder must have the matching UserRole --
// enforced here (the dropdown only lists matching users) and again
// server-side isn't needed since the position itself (not the role) is
// what workflow.ts checks when resolving a step's assignee.
const APPROVAL_ROLES = [
  { role: "ENGINEERING_CHIEF", label: "Ерөнхий инженер (Үйлдвэрийн чиглэл)", requiredRole: "ENGINEERING" },
  { role: "OPERATIONS_DIRECTOR", label: "Үйл ажиллагаа эрхэлсэн захирал (Оффисын чиглэл)", requiredRole: "DIRECTOR" },
  { role: "FINANCE_DIRECTOR", label: "Санхүү эрхэлсэн захирал", requiredRole: "DIRECTOR" },
  { role: "EXECUTIVE_DIRECTOR", label: "Гүйцэтгэх захирал", requiredRole: "DIRECTOR" },
  { role: "STOREKEEPER_LEAD", label: "Нярав", requiredRole: "STOREKEEPER" },
  { role: "CHIEF_ACCOUNTANT_LEAD", label: "Ерөнхий нягтлан бодогч", requiredRole: "CHIEF_ACCOUNTANT" },
] as const;

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  title: string | null;
  departmentId: string | null;
  departmentName: string | null;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  hasPinSet: boolean;
  pinLocked: boolean;
}

interface DepartmentOption {
  id: string;
  name: string;
  type: "OFFICE" | "FACTORY";
  headId: string | null;
  headName: string | null;
}

const inputClass =
  "focus-ring h-9 w-full rounded-lg border border-border bg-bg-elevated px-3 text-sm text-text placeholder:text-text-muted";

export default function AdminPage() {
  const { push } = useToast();
  const { data: session, status } = useSession();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [approvalRoles, setApprovalRoles] = useState<{ role: string; userId: string; userName: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [tempPassword, setTempPassword] = useState<{ email: string; password: string } | null>(null);
  const [passwordCopied, setPasswordCopied] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newRole, setNewRole] = useState<string>("EMPLOYEE");
  const [newDepartmentId, setNewDepartmentId] = useState<string>("");
  const [newDeptType, setNewDeptType] = useState<"ALL" | "FACTORY" | "OFFICE">("ALL");

  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [editDeptType, setEditDeptType] = useState<"ALL" | "FACTORY" | "OFFICE">("ALL");
  const [submitting, setSubmitting] = useState(false);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      const [u, d, a] = await Promise.all([
        fetch("/api/admin/users").then((r) => (r.ok ? r.json() : [])),
        fetch("/api/departments").then((r) => (r.ok ? r.json() : [])),
        fetch("/api/admin/approval-roles").then((r) => (r.ok ? r.json() : [])),
      ]);
      setUsers(u);
      setDepartments(d);
      setApprovalRoles(a);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);
  useLiveRefresh(() => {
    load(true); // keep the list on screen while it refreshes
  });

  async function createUser() {
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail, name: newName, title: newTitle || null, role: newRole, departmentId: newDepartmentId || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Хэрэглэгч үүсгэж чадсангүй");
      setCreateOpen(false);
      setNewEmail("");
      setNewName("");
      setNewTitle("");
      setNewRole("EMPLOYEE");
      setNewDepartmentId("");
      setNewDeptType("ALL");
      setTempPassword({ email: body.email, password: body.tempPassword });
      await load();
    } catch (err) {
      push({ kind: "error", title: "Хэрэглэгч үүсгэж чадсангүй", description: err instanceof Error ? err.message : undefined });
    } finally {
      setSubmitting(false);
    }
  }

  async function saveUserEdit() {
    if (!editUser) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/admin/users/${editUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: editUser.role, title: editUser.title, departmentId: editUser.departmentId, isActive: editUser.isActive }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error);
      setEditUser(null);
      push({ kind: "success", title: "Хадгалагдлаа" });
      await load();
    } catch (err) {
      push({ kind: "error", title: "Хадгалж чадсангүй", description: err instanceof Error ? err.message : undefined });
    } finally {
      setSubmitting(false);
    }
  }

  async function resetCredentials(user: AdminUser) {
    const res = await fetch(`/api/admin/users/${user.id}/reset-credentials`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      push({ kind: "error", title: "Нууц үг шинэчилж чадсангүй" });
      return;
    }
    setTempPassword({ email: user.email, password: body.tempPassword });
  }

  async function resetPin(user: AdminUser) {
    const res = await fetch(`/api/admin/users/${user.id}/reset-pin`, { method: "POST" });
    if (!res.ok) {
      push({ kind: "error", title: "PIN цуцлаж чадсангүй" });
      return;
    }
    push({ kind: "success", title: `${user.name}-ийн PIN цуцлагдлаа`, description: "Дараагийн баталгаажуулалтдаа шинэ PIN тохируулах шаардлагатай" });
    await load();
  }

  async function setApprovalRole(role: string, userId: string) {
    const res = await fetch("/api/admin/approval-roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, userId }),
    });
    if (!res.ok) {
      push({ kind: "error", title: "Хуваарилж чадсангүй" });
      return;
    }
    push({ kind: "success", title: "Хуваарилагдлаа" });
    await load();
  }

  async function setDepartmentHead(departmentId: string, headId: string) {
    const res = await fetch(`/api/admin/departments/${departmentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ headId: headId || null }),
    });
    if (!res.ok) {
      push({ kind: "error", title: "Хуваарилж чадсангүй" });
      return;
    }
    push({ kind: "success", title: "Цехийн дарга хуваарилагдлаа" });
    await load();
  }

  if (status === "authenticated" && session.user.role !== "ADMIN") {
    return <EmptyState title="Эрхгүй" description="Зөвхөн админ хэрэглэгч энэ хуудсыг харах боломжтой" />;
  }

  const columns: DataTableColumn<AdminUser>[] = [
    { key: "name", header: "Нэр", sortable: true, accessor: (u) => u.name, render: (u) => <span className="font-medium text-text">{u.name}</span> },
    { key: "email", header: "И-мэйл", sortable: true, accessor: (u) => u.email, render: (u) => u.email },
    { key: "role", header: "Эрх", sortable: true, accessor: (u) => u.role, render: (u) => USER_ROLE_LABEL[u.role] ?? u.role },
    { key: "title", header: "Албан тушаал", sortable: true, accessor: (u) => u.title ?? "", render: (u) => u.title ?? <span className="text-text-muted">—</span> },
    { key: "department", header: "Цех, тасаг", sortable: true, accessor: (u) => u.departmentName ?? "", render: (u) => u.departmentName ?? <span className="text-text-muted">—</span> },
    {
      key: "isActive",
      header: "Төлөв",
      sortable: true,
      accessor: (u) => (u.isActive ? 1 : 0),
      render: (u) => (
        <span className={u.isActive ? "text-success" : "text-text-muted"}>{u.isActive ? "Идэвхтэй" : "Идэвхгүй"}</span>
      ),
    },
    {
      key: "hasPinSet",
      header: "PIN",
      sortable: true,
      accessor: (u) => (u.hasPinSet ? 1 : 0),
      render: (u) =>
        u.pinLocked ? (
          <span className="text-danger">Түгжигдсэн</span>
        ) : u.hasPinSet ? (
          <span className="text-success">Тохируулсан</span>
        ) : (
          <span className="text-text-muted">Тохируулаагүй</span>
        ),
    },
    {
      key: "lastLoginAt",
      header: "Сүүлд нэвтэрсэн",
      sortable: true,
      accessor: (u) => u.lastLoginAt ?? "",
      render: (u) => (u.lastLoginAt ? formatDateTime(u.lastLoginAt) : <span className="text-text-muted">—</span>),
    },
    {
      key: "actions",
      header: "",
      sortable: false,
      accessor: () => "",
      render: (u) => (
        <div className="flex justify-end gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setEditUser(u);
              setEditDeptType(u.departmentId ? departments.find((d) => d.id === u.departmentId)?.type ?? "ALL" : "ALL");
            }}
          >
            <UserCog className="size-3.5" />
          </Button>
          <Button size="sm" variant="secondary" onClick={() => resetCredentials(u)} title="Нууц үг шинэчлэх">
            <RotateCcw className="size-3.5" />
          </Button>
          {u.hasPinSet && (
            <Button size="sm" variant="secondary" onClick={() => resetPin(u)} title="PIN цуцлах">
              <KeyRound className="size-3.5" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-text">Хэрэглэгч, эрхийн удирдлага</h2>
        <div className="flex gap-2">
          <Link href="/admin/audit">
            <Button variant="secondary">
              <FileClock className="size-4" />
              Audit log
            </Button>
          </Link>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            Шинэ хэрэглэгч
          </Button>
        </div>
      </div>

      <Card>
        {loading ? <SkeletonTable /> : <DataTable data={users} columns={columns} getRowId={(u) => u.id} searchPlaceholder="Хэрэглэгч хайх..." />}
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-accent" />
            <CardTitle>Баталгаажуулах эрхийн хуваарилалт</CardTitle>
          </div>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-xs text-text-muted">
            Чиглэлийн болон эцсийн баталгаажуулагчийг энд хэрэглэгчийн бүртгэлтэй холбож тохируулна. Систем нэр дээр
            биш, энэ хуваарилалт дээр үндэслэн эрх шалгадаг тул ажилтан солигдоход код засах шаардлагагүй.
          </p>
          {APPROVAL_ROLES.map((r) => {
            const current = approvalRoles.find((a) => a.role === r.role);
            return (
              <div key={r.role} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-bg-elevated/40 p-3">
                <div>
                  <p className="text-sm font-medium text-text">{r.label}</p>
                  <p className="text-[11px] text-text-muted">Одоогийн: {current?.userName ?? "Тохируулагдаагүй"}</p>
                </div>
                <select
                  value={current?.userId ?? ""}
                  onChange={(e) => e.target.value && setApprovalRole(r.role, e.target.value)}
                  className="focus-ring h-9 w-56 rounded-lg border border-border bg-bg-surface px-3 text-sm text-text"
                >
                  <option value="" disabled>
                    Хэрэглэгч сонгох
                  </option>
                  {users.filter((u) => u.isActive && u.role === r.requiredRole).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
          <p className="text-[11px] text-text-muted">
            Албан тушаал бүрт зохих эрхтэй, идэвхтэй хэрэглэгч л сонгох боломжтой.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Цех, тасгийн дарга</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-xs text-text-muted">
            Цех/тасаг тус бүрийн дарга — тухайн цехээс гарсан захиалгыг эхэлж батлах хүн (Stage 2). Dropdown нь
            одоогийн хуваарилалтыг шууд харуулна.
          </p>
          {departments.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-bg-elevated/40 p-3">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-[10px] font-medium",
                    d.type === "FACTORY" ? "bg-accent/15 text-accent" : "bg-text-muted/15 text-text-muted"
                  )}
                >
                  {d.type === "FACTORY" ? "Үйлдвэр" : "Оффис"}
                </span>
                <p className="text-sm font-medium text-text">{d.name}</p>
              </div>
              <select
                value={d.headId ?? ""}
                onChange={(e) => setDepartmentHead(d.id, e.target.value)}
                className="focus-ring h-9 w-56 rounded-lg border border-border bg-bg-surface px-3 text-sm text-text"
              >
                <option value="">— Тохируулагдаагүй —</option>
                {users.filter((u) => u.isActive).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </CardBody>
      </Card>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Шинэ хэрэглэгч үүсгэх">
        <div className="space-y-3">
          <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="И-мэйл" className={inputClass} />
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Овог, нэр" className={inputClass} />
          <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Албан тушаал (жиш: Цехийн дарга)" className={inputClass} />
          <select value={newRole} onChange={(e) => setNewRole(e.target.value)} className={inputClass}>
            {USER_ROLES.map((r) => (
              <option key={r} value={r}>
                {USER_ROLE_LABEL[r]}
              </option>
            ))}
          </select>
          <ul className="list-disc space-y-1 rounded-lg border border-border bg-bg-elevated/40 p-3 pl-7 text-xs text-text-muted">
            {(ROLE_PERMISSION_SUMMARY[newRole as keyof typeof ROLE_PERMISSION_SUMMARY] ?? []).map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <div className="flex gap-1.5 rounded-lg border border-border bg-bg-elevated/40 p-1">
            {(["ALL", "FACTORY", "OFFICE"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setNewDeptType(t);
                  if (t !== "ALL" && newDepartmentId) {
                    const current = departments.find((d) => d.id === newDepartmentId);
                    if (current && current.type !== t) setNewDepartmentId("");
                  }
                }}
                className={cn(
                  "h-8 flex-1 rounded-md text-xs font-medium transition-colors",
                  newDeptType === t ? "bg-accent text-bg" : "text-text-muted hover:text-text"
                )}
              >
                {t === "ALL" ? "Бүгд" : t === "FACTORY" ? "Үйлдвэр" : "Оффис"}
              </button>
            ))}
          </div>
          <DepartmentCombobox
            value={newDepartmentId || null}
            departments={newDeptType === "ALL" ? departments : departments.filter((d) => d.type === newDeptType)}
            onSelect={(id) => setNewDepartmentId(id ?? "")}
            onCreated={(d) => setDepartments((prev) => [...prev, { ...d, headId: null, headName: null }].sort((a, b) => a.name.localeCompare(b.name)))}
            fixedType={newDeptType === "ALL" ? undefined : newDeptType}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Болих
            </Button>
            <Button onClick={createUser} loading={submitting} disabled={!newEmail || !newName}>
              Үүсгэх
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!editUser} onClose={() => setEditUser(null)} title="Хэрэглэгч засах">
        {editUser && (
          <div className="space-y-3">
            <p className="text-sm text-text">
              {editUser.name} <span className="text-text-muted">({editUser.email})</span>
            </p>
            <input
              value={editUser.title ?? ""}
              onChange={(e) => setEditUser({ ...editUser, title: e.target.value })}
              placeholder="Албан тушаал"
              className={inputClass}
            />
            <select
              value={editUser.role}
              onChange={(e) => setEditUser({ ...editUser, role: e.target.value })}
              className={inputClass}
            >
              {USER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {USER_ROLE_LABEL[r]}
                </option>
              ))}
            </select>
            <ul className="list-disc space-y-1 rounded-lg border border-border bg-bg-elevated/40 p-3 pl-7 text-xs text-text-muted">
              {(ROLE_PERMISSION_SUMMARY[editUser.role as keyof typeof ROLE_PERMISSION_SUMMARY] ?? []).map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <div className="flex gap-1.5 rounded-lg border border-border bg-bg-elevated/40 p-1">
              {(["ALL", "FACTORY", "OFFICE"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setEditDeptType(t);
                    if (t !== "ALL" && editUser.departmentId) {
                      const current = departments.find((d) => d.id === editUser.departmentId);
                      if (current && current.type !== t) setEditUser({ ...editUser, departmentId: null });
                    }
                  }}
                  className={cn(
                    "h-8 flex-1 rounded-md text-xs font-medium transition-colors",
                    editDeptType === t ? "bg-accent text-bg" : "text-text-muted hover:text-text"
                  )}
                >
                  {t === "ALL" ? "Бүгд" : t === "FACTORY" ? "Үйлдвэр" : "Оффис"}
                </button>
              ))}
            </div>
            <DepartmentCombobox
              value={editUser.departmentId}
              departments={editDeptType === "ALL" ? departments : departments.filter((d) => d.type === editDeptType)}
              onSelect={(id) => setEditUser({ ...editUser, departmentId: id })}
              onCreated={(d) => setDepartments((prev) => [...prev, { ...d, headId: null, headName: null }].sort((a, b) => a.name.localeCompare(b.name)))}
              fixedType={editDeptType === "ALL" ? undefined : editDeptType}
            />
            <label className="flex items-center gap-2 text-sm text-text">
              <input
                type="checkbox"
                checked={editUser.isActive}
                onChange={(e) => setEditUser({ ...editUser, isActive: e.target.checked })}
              />
              Идэвхтэй
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEditUser(null)}>
                Болих
              </Button>
              <Button onClick={saveUserEdit} loading={submitting}>
                Хадгалах
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!tempPassword}
        onClose={() => {
          setTempPassword(null);
          setPasswordCopied(false);
        }}
        title="Түр нууц үг"
      >
        {tempPassword && (
          <div className="space-y-3">
            <p className="text-sm text-text-muted">
              {tempPassword.email}-д зориулсан түр нууц үг. Энэ зөвхөн нэг удаа харагдах тул хэрэглэгчид аюулгүй
              аргаар дамжуулна уу.
            </p>
            <div className="flex items-center gap-2">
              <p className="flex-1 rounded-lg border border-border bg-bg-elevated px-3 py-2 text-center font-mono text-sm text-text">
                {tempPassword.password}
              </p>
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(tempPassword.password);
                    setPasswordCopied(true);
                    setTimeout(() => setPasswordCopied(false), 2000);
                  } catch {
                    push({ kind: "error", title: "Хуулж чадсангүй", description: "Гараараа сонгож хуулна уу" });
                  }
                }}
              >
                {passwordCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
                {passwordCopied ? "Хууллаа" : "Хуулах"}
              </Button>
            </div>
            <div className="flex justify-end">
              <Button
                onClick={() => {
                  setTempPassword(null);
                  setPasswordCopied(false);
                }}
              >
                Хаах
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
