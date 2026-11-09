"use client";

import { useEffect, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { CheckCircle2, KeyRound, Lock, ShieldAlert } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { APPROVER_ROLES } from "@/lib/types";

interface DepartmentOption {
  id: string;
  name: string;
  type: "OFFICE" | "FACTORY";
}

const APPROVER_ROLE_SET = new Set<string>(APPROVER_ROLES);
const inputClass =
  "focus-ring h-9 w-full rounded-lg border border-border bg-bg-elevated px-3 text-sm text-text placeholder:text-text-muted";

export default function SettingsPage() {
  const { push } = useToast();
  const { data: session } = useSession();
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinPassword, setPinPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pwCurrentPassword, setPwCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [pwSubmitting, setPwSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/departments")
      .then((res) => (res.ok ? res.json() : []))
      .then((data: DepartmentOption[]) => setDepartments(data))
      .catch(() => setDepartments([]));
  }, []);

  useEffect(() => {
    fetch("/api/me/pin")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { hasPin: boolean } | null) => setHasPin(data?.hasPin ?? null))
      .catch(() => setHasPin(null));
  }, []);

  const canHoldApproval = !!session?.user?.role && APPROVER_ROLE_SET.has(session.user.role);

  async function savePin() {
    setSubmitting(true);
    try {
      const res = await fetch("/api/me/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, confirmPin, currentPassword: pinPassword }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "PIN тохируулж чадсангүй");
      setHasPin(true);
      setPin("");
      setConfirmPin("");
      setPinPassword("");
      push({ kind: "success", title: "PIN амжилттай тохируулагдлаа" });
    } catch (err) {
      push({ kind: "error", title: "PIN тохируулж чадсангүй", description: err instanceof Error ? err.message : undefined });
    } finally {
      setSubmitting(false);
    }
  }

  async function savePassword() {
    setPwSubmitting(true);
    try {
      const res = await fetch("/api/me/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: pwCurrentPassword, newPassword, confirmPassword: confirmNewPassword }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Нууц үг сольж чадсангүй");
      setPwCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      // every session issued before the change is revoked, this one included: sign in again with the new password
      push({ kind: "success", title: "Нууц үг амжилттай солигдлоо", description: "Шинэ нууц үгээрээ дахин нэвтэрнэ үү" });
      window.setTimeout(() => void signOut({ callbackUrl: "/login" }), 1500);
    } catch (err) {
      push({ kind: "error", title: "Нууц үг сольж чадсангүй", description: err instanceof Error ? err.message : undefined });
    } finally {
      setPwSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-text">Тохиргоо</h2>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Lock className="size-4 text-accent" />
            <CardTitle>Нууц үг солих</CardTitle>
          </div>
        </CardHeader>
        <CardBody className="space-y-4">
          <p className="text-xs text-text-muted">
            Админаас авсан түр нууц үгийг энд өөрийн мэддэг нууц үгээр сольж болно.
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-text-muted">Одоогийн нууц үг</span>
              <input
                type="password"
                value={pwCurrentPassword}
                onChange={(e) => setPwCurrentPassword(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-text-muted">Шинэ нууц үг (дор хаяж 8 тэмдэгт)</span>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-text-muted">Шинэ нууц үг давтах</span>
              <input
                type="password"
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                className={inputClass}
              />
            </label>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={savePassword}
              loading={pwSubmitting}
              disabled={!pwCurrentPassword || newPassword.length < 8 || confirmNewPassword.length < 8}
            >
              Нууц үг солих
            </Button>
          </div>
        </CardBody>
      </Card>

      {canHoldApproval && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <KeyRound className="size-4 text-accent" />
              <CardTitle>Миний баталгаажуулах PIN</CardTitle>
            </div>
          </CardHeader>
          <CardBody className="space-y-4">
            <p className="text-xs text-text-muted">
              Захиалга батлахдаа энэ дөрвөн оронтой PIN-ээр баталгаажуулна. Хэн ч, админ ч, таны PIN-ийг харах
              боломжгүй — зөвхөн та мэднэ.
            </p>

            {hasPin !== null && (
              <div
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
                  hasPin ? "border-success/30 bg-success/10 text-success" : "border-warning/30 bg-warning/10 text-warning"
                }`}
              >
                {hasPin ? <CheckCircle2 className="size-3.5" /> : <ShieldAlert className="size-3.5" />}
                {hasPin ? "PIN тохируулагдсан" : "PIN тохируулаагүй байна"}
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-text-muted">Шинэ PIN (4 орон)</span>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-text-muted">PIN давтах</span>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  className={inputClass}
                />
              </label>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-text-muted">Одоогийн нууц үг (PIN тохируулах, солиход заавал)</span>
              <input
                type="password"
                autoComplete="current-password"
                value={pinPassword}
                onChange={(e) => setPinPassword(e.target.value)}
                className={inputClass}
              />
            </label>

            <div className="flex justify-end">
              <Button
                onClick={savePin}
                loading={submitting}
                disabled={pin.length !== 4 || confirmPin.length !== 4 || pinPassword.length === 0}
              >
                {hasPin ? "PIN солих" : "PIN тохируулах"}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Цех, тасгийн жагсаалт</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2">
          {departments.map((d) => (
            <div key={d.id} className="flex items-center justify-between rounded-lg border border-border bg-bg-elevated/40 px-3 py-2 text-sm">
              <span className="text-text">{d.name}</span>
              <span className="text-xs text-text-muted">{d.type === "FACTORY" ? "Үйлдвэр" : "Оффис"}</span>
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
