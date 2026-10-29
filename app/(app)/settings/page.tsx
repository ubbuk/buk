"use client";

import { useState } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { DemoDataBadge } from "@/components/ui/StatusBadge";
import { useToast } from "@/components/ui/Toast";
import { DEMO_DEPARTMENTS } from "@/lib/mock-session";
import { Save, ShieldCheck } from "lucide-react";

const APPROVAL_ROLES = [
  { role: "OFFICE_APPROVER", label: "Оффисын чиглэлийн баталгаажуулагч", current: "Н.Хүнцэнгэл" },
  { role: "FACTORY_APPROVER", label: "Үйлдвэрийн чиглэлийн баталгаажуулагч", current: "Б.Нармандах" },
  { role: "DIRECTOR", label: "Эцсийн баталгаажуулагч (Захирал)", current: "Хамхоев Магомед" },
] as const;

export default function SettingsPage() {
  const { push } = useToast();
  const [assignments, setAssignments] = useState<Record<string, string>>(
    Object.fromEntries(APPROVAL_ROLES.map((r) => [r.role, r.current]))
  );

  function save() {
    push({
      kind: "success",
      title: "Тохиргоо хадгалагдлаа",
      description: "Энэ дэлгэц одоогоор жишээ горимд ажиллаж байна — бодит хадгалалт Phase 3-д холбогдоно",
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-text">Тохиргоо</h2>
        <DemoDataBadge />
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-accent" />
            <CardTitle>Баталгаажуулах эрхийн хуваарилалт</CardTitle>
          </div>
        </CardHeader>
        <CardBody className="space-y-4">
          <p className="text-xs text-text-muted">
            Чиглэлийн болон эцсийн баталгаажуулагчийг энд хэрэглэгчийн бүртгэлтэй холбож тохируулна.
            Систем нэр дээр биш, энэ хуваарилалт дээр үндэслэн эрх шалгадаг тул ажилтан солигдоход код
            засах шаардлагагүй.
          </p>
          <div className="space-y-3">
            {APPROVAL_ROLES.map((r) => (
              <div
                key={r.role}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-bg-elevated/40 p-3"
              >
                <div>
                  <p className="text-sm font-medium text-text">{r.label}</p>
                  <p className="text-[11px] text-text-muted">{r.role}</p>
                </div>
                <input
                  value={assignments[r.role]}
                  onChange={(e) => setAssignments((prev) => ({ ...prev, [r.role]: e.target.value }))}
                  className="focus-ring h-9 w-56 rounded-lg border border-border bg-bg-surface px-3 text-sm text-text"
                />
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <Button onClick={save}>
              <Save className="size-4" />
              Хадгалах
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Цех, тасгийн жагсаалт</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2">
          {DEMO_DEPARTMENTS.map((d) => (
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
