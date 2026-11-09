"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Check, Copy, FileClock, KeyRound, Plus, RotateCcw, ShieldCheck, Trash2, UserCog } from "lucide-react";
import { AuthorityGrantDialog, type GrantRequest, type GrantStepUp } from "@/components/admin/AuthorityGrantDialog";
import { DepartmentCombobox } from "@/components/admin/DepartmentCombobox";
import { ProcurementHandoverDialog } from "@/components/admin/ProcurementHandoverDialog";
import { ExecutiveHandoverDialog } from "@/components/admin/ExecutiveHandoverDialog";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { DataTable, type DataTableColumn } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { isAdminRoleGrantLocked, isPrivilegedRole } from "@/lib/authority-roles";
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
  { role: "DOMESTIC_PROCUREMENT_MANAGER", label: "Дотоодын худалдан авалтын менежер", requiredRole: "MANAGER" },
  { role: "INTERNATIONAL_PROCUREMENT_MANAGER", label: "Олон улсын худалдан авалтын менежер", requiredRole: "MANAGER" },
] as const;

type ProcurementPosition = "DOMESTIC_PROCUREMENT_MANAGER" | "INTERNATIONAL_PROCUREMENT_MANAGER";
const isProcurementPosition = (role: string): role is ProcurementPosition => role === "DOMESTIC_PROCUREMENT_MANAGER" || role === "INTERNATIONAL_PROCUREMENT_MANAGER";

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
  const [pinReset, setPinReset] = useState<{ user: AdminUser; reason: string; identityVerified: boolean; adminPassword: string } | null>(null);
  const [pinResetBusy, setPinResetBusy] = useState(false);
  const [passwordCopied, setPasswordCopied] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [newAdminPassword, setNewAdminPassword] = useState("");
  // creating an account that already carries a privileged role is a grant: reason + confirmation inline
  const [newReason, setNewReason] = useState("");
  const [newConfirmed, setNewConfirmed] = useState(false);
  // granting authority (role, position, department head) asks for a reason, confirmation and the admin own password
  const [grantAsk, setGrantAsk] = useState<GrantRequest | null>(null);
  // Resetting a password hands the admin a temporary one, so it needs a reason, the identity attestation and the admin own password.
  const [credReset, setCredReset] = useState<{ user: AdminUser; reason: string; identityVerified: boolean; adminPassword: string; error: string | null } | null>(null);
  const [credResetBusy, setCredResetBusy] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newRole, setNewRole] = useState<string>("EMPLOYEE");
  const [newDepartmentId, setNewDepartmentId] = useState<string>("");
  const [newDeptType, setNewDeptType] = useState<"ALL" | "FACTORY" | "OFFICE">("ALL");

  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [editDeptType, setEditDeptType] = useState<"ALL" | "FACTORY" | "OFFICE">("ALL");
  const [submitting, setSubmitting] = useState(false);
  const [handover, setHandover] = useState<{ position: ProcurementPosition; label: string; managerId: string } | null>(null);
  const [executiveHandoverOpen, setExecutiveHandoverOpen] = useState(false);

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
        body: JSON.stringify({ email: newEmail, name: newName, title: newTitle || null, role: newRole, departmentId: newDepartmentId || null, adminPassword: newAdminPassword, ...(isPrivilegedRole(newRole) ? { reason: newReason, confirmed: newConfirmed } : {}) }),
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
      setNewReason("");
      setNewConfirmed(false);
      setTempPassword({ email: body.email, password: body.tempPassword });
      await load();
    } catch (err) {
      push({ kind: "error", title: "Хэрэглэгч үүсгэж чадсангүй", description: err instanceof Error ? err.message : undefined });
    } finally {
      setNewAdminPassword("");
      setSubmitting(false);
    }
  }

  async function saveUserEdit() {
    if (!editUser) return;
    setSubmitting(true);
    try {
      const target = editUser;
      let acknowledged = false;
      const send = (acknowledgeUnfinishedProcurement: boolean, step?: GrantStepUp) =>
        fetch(`/api/admin/users/${target.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: target.role, title: target.title, departmentId: target.departmentId, isActive: target.isActive, acknowledgeUnfinishedProcurement, ...step }),
        });
      let res = await send(false);
      if (res.status === 409) {
        const body = await res.clone().json().catch(() => ({}));
        if (body.code === "HANDOVER_REQUIRED") {
          // the safe path is a handover first; deactivating anyway needs a deliberate second confirmation
          const proceed = window.confirm(`${body.error}

Хамгаалалтын шалтгаанаар ямар ч тохиолдолд идэвхгүй болгох бол OK дарна уу (ажил шилжихгүй, Админ дараа нь «Дуусаагүй ажлыг шилжүүлэх» үйлдлийг хийнэ).`);
          if (!proceed) return;
          acknowledged = true;
          res = await send(true);
        }
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body?.code === "STEP_UP_REQUIRED") {
          // the change grants authority: ask for reason, confirmation and the admin own password, then repeat it
          setGrantAsk({
            title: "Эрх олгохыг баталгаажуулах",
            summary: `${target.name} (${target.email}): ${USER_ROLE_LABEL[target.role as keyof typeof USER_ROLE_LABEL] ?? target.role}`,
            run: async (step) => {
              const again = await send(acknowledged, step);
              if (!again.ok) return (await again.json().catch(() => ({})))?.error ?? "Эрх олгож чадсангүй";
              setEditUser(null);
              push({ kind: "success", title: "Хадгалагдлаа" });
              await load();
              return null;
            },
          });
          return;
        }
        throw new Error(body?.error);
      }
      setEditUser(null);
      push({ kind: "success", title: "Хадгалагдлаа" });
      await load();
    } catch (err) {
      push({ kind: "error", title: "Хадгалж чадсангүй", description: err instanceof Error ? err.message : undefined });
    } finally {
      setSubmitting(false);
    }
  }

  async function submitCredentialReset() {
    if (!credReset) return;
    setCredResetBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${credReset.user.id}/reset-credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: credReset.reason, identityVerified: credReset.identityVerified, adminPassword: credReset.adminPassword }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // shown in the dialog itself: e.g. the clear message for an approval-capable account
        setCredReset({ ...credReset, adminPassword: "", error: body.error || "Нууц үг шинэчилж чадсангүй" });
        return;
      }
      setTempPassword({ email: credReset.user.email, password: body.tempPassword });
      setCredReset(null);
    } finally {
      setCredResetBusy(false);
    }
  }

  // Resetting somebody's PIN needs a reason, the admin's attestation that the employee's identity was verified and the
  // admin's own password. The admin never sees or chooses a PIN: the employee creates a new one with their own password.
  async function submitPinReset() {
    if (!pinReset) return;
    setPinResetBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${pinReset.user.id}/reset-pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: pinReset.reason, identityVerified: pinReset.identityVerified, adminPassword: pinReset.adminPassword }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        push({ kind: "error", title: "PIN цуцалж чадсангүй", description: body.error });
        return;
      }
      push({ kind: "success", title: `${pinReset.user.name}-ийн PIN цуцлагдлаа`, description: "Ажилтан өөрийн нууц үгээрээ шинэ PIN тохируулах шаардлагатай" });
      setPinReset(null);
      await load();
    } finally {
      setPinResetBusy(false);
    }
  }

  async function deleteUser(user: AdminUser) {
    if (!window.confirm(`${user.name} (${user.email}) хэрэглэгчийг өгөгдлийн сангаас бүрмөсөн устгах уу?`)) return;
    const res = await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      push({ kind: "error", title: "Устгаж чадсангүй", description: body.error });
      return;
    }
    push({ kind: "success", title: `${user.name} устгагдлаа` });
    await load();
  }

  async function setApprovalRole(role: string, userId: string) {
    if (isProcurementPosition(role)) {
      // procurement managers are replaced through the reviewed handover dialog, never blindly
      setHandover({ position: role, label: APPROVAL_ROLES.find((r) => r.role === role)?.label ?? role, managerId: userId });
      return;
    }
    const send = (step?: GrantStepUp) =>
      fetch("/api/admin/approval-roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, userId, ...step }),
      });
    const res = await send();
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (body.code === "STEP_UP_REQUIRED") {
        const holder = users.find((u) => u.id === userId);
        setGrantAsk({
          title: "Албан тушаал олгохыг баталгаажуулах",
          summary: `${holder?.name ?? "Хэрэглэгч"} → ${APPROVAL_ROLES.find((r) => r.role === role)?.label ?? role}`,
          run: async (step) => {
            const again = await send(step);
            if (!again.ok) return (await again.json().catch(() => ({})))?.error ?? "Хуваарилж чадсангүй";
            push({ kind: "success", title: "Хуваарилагдлаа" });
            await load();
            return null;
          },
        });
        return;
      }
      push({ kind: "error", title: "Хуваарилж чадсангүй", description: body.error });
      return;
    }
    push({ kind: "success", title: "Хуваарилагдлаа" });
    await load();
  }

  async function setDepartmentHead(departmentId: string, headId: string) {
    const send = (step?: GrantStepUp) =>
      fetch(`/api/admin/departments/${departmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ headId: headId || null, ...step }),
      });
    const done = async (res: Response) => {
      const { reassignedRequests } = await res.json().catch(() => ({ reassignedRequests: 0 }));
      push({
        kind: "success",
        title: "Цехийн дарга хуваарилагдлаа",
        description: reassignedRequests > 0 ? `Хүлээгдэж буй ${reassignedRequests} захиалга шинэ даргад шилжлээ` : undefined,
      });
      await load();
    };
    const res = await send();
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (body.code === "STEP_UP_REQUIRED") {
        const head = users.find((u) => u.id === headId);
        const dept = departments.find((d) => d.id === departmentId);
        setGrantAsk({
          title: "Цехийн дарга томилохыг баталгаажуулах",
          summary: `${head?.name ?? "Хэрэглэгч"} → «${dept?.name ?? "цех"}» цехийн дарга`,
          run: async (step) => {
            const again = await send(step);
            if (!again.ok) return (await again.json().catch(() => ({})))?.error ?? "Хуваарилж чадсангүй";
            await done(again);
            return null;
          },
        });
        return;
      }
      push({ kind: "error", title: "Хуваарилж чадсангүй", description: body.error });
      return;
    }
    await done(res);
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
            title="Засах"
            aria-label={`${u.name}-ийг засах`}
            onClick={() => {
              setEditUser(u);
              setEditDeptType(u.departmentId ? departments.find((d) => d.id === u.departmentId)?.type ?? "ALL" : "ALL");
            }}
          >
            <UserCog className="size-3.5" />
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setCredReset({ user: u, reason: "", identityVerified: false, adminPassword: "", error: null })} title="Нууц үг шинэчлэх" aria-label={`${u.name}-ийн нууц үг шинэчлэх`}>
            <RotateCcw className="size-3.5" />
          </Button>
          {u.id !== session?.user?.id && (
            <Button size="sm" variant="secondary" onClick={() => deleteUser(u)} title="Устгах">
              <Trash2 className="size-3.5" />
            </Button>
          )}
          {u.hasPinSet && (
            <Button size="sm" variant="secondary" onClick={() => setPinReset({ user: u, reason: "", identityVerified: false, adminPassword: "" })} title="PIN цуцлах" aria-label={`${u.name}-ийн PIN цуцлах`}>
              <KeyRound className="size-3.5" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-text">Хэрэглэгч, эрхийн удирдлага</h2>
        <div className="flex flex-wrap gap-2">
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
                {r.role === "EXECUTIVE_DIRECTOR" && (
                  <Button variant="secondary" size="sm" onClick={() => setExecutiveHandoverOpen(true)}>
                    Хүлээгдэж буй баталгааг шилжүүлэх
                  </Button>
                )}
                {isProcurementPosition(r.role) && (
                  <Button variant="secondary" size="sm" onClick={() => setHandover({ position: r.role as ProcurementPosition, label: r.label, managerId: current?.userId ?? "" })}>
                    Дуусаагүй ажлыг шилжүүлэх
                  </Button>
                )}
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

      <Modal
        open={!!credReset}
        onClose={() => setCredReset(null)}
        title="Ажилтны нууц үг сэргээх"
        description="Энэ нь түр нууц үг үүсгэж танд харуулна. Батлах эрхтэй хэрэглэгчийн нууц үгийг энэ аргаар сэргээх боломжгүй. Үйлдэл аудитад бүртгэгдэж, ажилтанд мэдэгдэл очно."
      >
        {credReset && (
          <div className="space-y-3 text-sm">
            <p className="break-words text-xs text-text-muted">
              Ажилтан: <b className="text-text">{credReset.user.name}</b> ({credReset.user.email})
            </p>
            {credReset.error && (
              <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
                {credReset.error}
              </p>
            )}
            <label className="flex items-start gap-2 rounded-lg border border-border bg-bg-elevated/40 p-3 text-xs text-text">
              <input
                type="checkbox"
                className="mt-0.5 size-4"
                checked={credReset.identityVerified}
                onChange={(e) => setCredReset({ ...credReset, identityVerified: e.target.checked })}
              />
              <span>Би энэ ажилтны хувийн байдлыг биечлэн эсвэл найдвартай арга замаар (жишээ нь буцаж залгах) баталгаажуулсан.</span>
            </label>
            <label className="block space-y-1 text-xs text-text-muted">
              Сэргээх шалтгаан, баталгаажуулсан арга (заавал)
              <textarea
                value={credReset.reason}
                onChange={(e) => setCredReset({ ...credReset, reason: e.target.value })}
                rows={3}
                maxLength={500}
                className="focus-ring w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text"
              />
            </label>
            <label className="block space-y-1 text-xs text-text-muted">
              Таны өөрийн нууц үг
              <input
                type="password"
                autoComplete="current-password"
                value={credReset.adminPassword}
                onChange={(e) => setCredReset({ ...credReset, adminPassword: e.target.value })}
                className="focus-ring h-11 w-full rounded-lg border border-border bg-bg-elevated px-3 text-sm text-text"
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setCredReset(null)}>
                Болих
              </Button>
              <Button
                variant="danger"
                loading={credResetBusy}
                disabled={!credReset.identityVerified || credReset.reason.trim().length < 3 || credReset.adminPassword.length === 0}
                onClick={() => void submitCredentialReset()}
              >
                Нууц үг сэргээх
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={!!pinReset}
        onClose={() => setPinReset(null)}
        title="Ажилтны PIN цуцлах"
        description="Та PIN-ийг харах, сонгох боломжгүй. Цуцалсны дараа ажилтан өөрийн нууц үгээрээ шинэ дөрвөн оронтой PIN үүсгэнэ."
      >
        {pinReset && (
          <div className="space-y-3 text-sm">
            <p className="text-xs text-text-muted">
              Ажилтан: <b className="text-text">{pinReset.user.name}</b> ({pinReset.user.email})
            </p>
            <label className="flex items-start gap-2 rounded-lg border border-border bg-bg-elevated/40 p-3 text-xs text-text">
              <input
                type="checkbox"
                className="mt-0.5 size-4"
                checked={pinReset.identityVerified}
                onChange={(e) => setPinReset({ ...pinReset, identityVerified: e.target.checked })}
              />
              <span>Би энэ ажилтны хувийн байдлыг биечлэн эсвэл найдвартай арга замаар (жишээ нь буцаж залгах) баталгаажуулсан.</span>
            </label>
            <label className="block space-y-1 text-xs text-text-muted">
              Цуцлах шалтгаан, баталгаажуулсан арга (заавал)
              <textarea
                value={pinReset.reason}
                onChange={(e) => setPinReset({ ...pinReset, reason: e.target.value })}
                rows={3}
                maxLength={500}
                className="focus-ring w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text"
              />
            </label>
            <label className="block space-y-1 text-xs text-text-muted">
              Таны өөрийн нууц үг
              <input
                type="password"
                autoComplete="current-password"
                value={pinReset.adminPassword}
                onChange={(e) => setPinReset({ ...pinReset, adminPassword: e.target.value })}
                className="focus-ring h-11 w-full rounded-lg border border-border bg-bg-elevated px-3 text-sm text-text"
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPinReset(null)}>
                Болих
              </Button>
              <Button
                variant="danger"
                loading={pinResetBusy}
                disabled={!pinReset.identityVerified || pinReset.reason.trim().length < 3 || pinReset.adminPassword.length === 0}
                onClick={() => void submitPinReset()}
              >
                PIN цуцлах
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <ExecutiveHandoverDialog
        open={executiveHandoverOpen}
        currentHolder={(() => {
          const holder = approvalRoles.find((a) => a.role === "EXECUTIVE_DIRECTOR");
          return holder ? { id: holder.userId, name: holder.userName } : null;
        })()}
        directors={users.filter((u) => u.role === "DIRECTOR").map((u) => ({ id: u.id, name: u.name, isActive: u.isActive }))}
        onClose={() => setExecutiveHandoverOpen(false)}
        onDone={() => void load()}
      />

      {handover && (
        <ProcurementHandoverDialog
          open
          position={handover.position}
          label={handover.label}
          initialManagerId={handover.managerId}
          managers={users.filter((u) => u.isActive && u.role === "MANAGER").map((u) => ({ id: u.id, name: u.name }))}
          onClose={() => setHandover(null)}
          onDone={() => void load()}
        />
      )}

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
                {users.filter((u) => u.isActive && u.role === "BOSS").map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </CardBody>
      </Card>

      <AuthorityGrantDialog request={grantAsk} onClose={() => setGrantAsk(null)} />

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Шинэ хэрэглэгч үүсгэх">
        <div className="space-y-3">
          <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="И-мэйл" className={inputClass} />
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Овог, нэр" className={inputClass} />
          <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Албан тушаал (жиш: Цехийн дарга)" className={inputClass} />
          <select value={newRole} onChange={(e) => setNewRole(e.target.value)} className={inputClass}>
            {/* the ADMIN role is never created through the application (one administrator): lib/authority-roles.ts */}
            {USER_ROLES.filter((r) => !isAdminRoleGrantLocked(r)).map((r) => (
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
          {isPrivilegedRole(newRole) && (
            <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-3" data-testid="create-grant">
              <p className="text-xs text-text">Энэ эрх нь шинэ хэрэглэгчид эрх олгож байгаа тул шалтгаан, баталгаажуулалт шаардлагатай. Бусад админд мэдэгдэл очно.</p>
              <label className="block space-y-1 text-xs text-text-muted">
                Эрх олгох шалтгаан (заавал)
                <textarea
                  value={newReason}
                  onChange={(e) => setNewReason(e.target.value)}
                  rows={2}
                  maxLength={500}
                  className="focus-ring w-full rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text"
                />
              </label>
              <label className="flex items-start gap-2 text-xs text-text">
                <input type="checkbox" className="mt-0.5 size-4" checked={newConfirmed} onChange={(e) => setNewConfirmed(e.target.checked)} />
                <span>Би энэ хүнд дээрх эрхийг өгөх эрхтэй бөгөөд хариуцлагыг хүлээнэ.</span>
              </label>
            </div>
          )}
          <label className="block space-y-1 text-xs text-text-muted">
            Таны өөрийн нууц үг (түр нууц үг өгөгдөх тул заавал)
            <input
              type="password"
              autoComplete="current-password"
              value={newAdminPassword}
              onChange={(e) => setNewAdminPassword(e.target.value)}
              className="focus-ring h-11 w-full rounded-lg border border-border bg-bg-elevated px-3 text-sm text-text"
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Болих
            </Button>
            <Button onClick={createUser} loading={submitting} disabled={!newEmail || !newName || !newAdminPassword || (isPrivilegedRole(newRole) && (!newConfirmed || newReason.trim().length < 3))}>
              Үүсгэх
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!editUser && !grantAsk} onClose={() => setEditUser(null)} title="Хэрэглэгч засах">
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
              {USER_ROLES.filter((r) => !isAdminRoleGrantLocked(r) || r === editUser.role).map((r) => (
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
              аргаар дамжуулна уу. Үүнийг ашиглан тухайн хэрэглэгчийн оронд нэвтрэхийг хориглоно: үйлдэл аудитад бүртгэгдсэн.
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
