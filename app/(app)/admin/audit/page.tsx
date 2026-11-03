"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import { formatDateTime } from "@/lib/utils";

interface AuditRow {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  actorName: string;
  beforeJson: string | null;
  afterJson: string | null;
  createdAt: string;
}

export default function AdminAuditPage() {
  const { data: session, status } = useSession();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const pageSize = 50;

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/audit-log?page=${page}`)
      .then((res) => (res.ok ? res.json() : { rows: [], total: 0 }))
      .then((data) => {
        setRows(data.rows);
        setTotal(data.total);
      })
      .finally(() => setLoading(false));
  }, [page]);

  if (status === "authenticated" && session.user.role !== "ADMIN") {
    return <EmptyState title="Эрхгүй" description="Зөвхөн админ хэрэглэгч энэ хуудсыг харах боломжтой" />;
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/admin">
          <Button variant="secondary" size="sm">
            <ArrowLeft className="size-3.5" />
            Буцах
          </Button>
        </Link>
        <h2 className="text-lg font-semibold text-text">Системийн audit log</h2>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Үйлдлийн түүх</CardTitle>
          <span className="text-xs text-text-muted">{total} бичлэг</span>
        </CardHeader>
        {loading ? (
          <SkeletonTable />
        ) : rows.length === 0 ? (
          <EmptyState title="Бичлэг алга" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-text-muted">
                  <th className="px-5 py-2.5 font-medium">Огноо</th>
                  <th className="px-3 py-2.5 font-medium">Хэрэглэгч</th>
                  <th className="px-3 py-2.5 font-medium">Үйлдэл</th>
                  <th className="px-3 py-2.5 font-medium">Обьект</th>
                  <th className="px-3 py-2.5 font-medium">Дэлгэрэнгүй</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border/60 align-top last:border-0">
                    <td className="px-5 py-3 text-text-muted">{formatDateTime(r.createdAt)}</td>
                    <td className="px-3 py-3 text-text">{r.actorName}</td>
                    <td className="px-3 py-3 text-text">{r.action}</td>
                    <td className="px-3 py-3 text-text-muted">
                      {r.entityType} · {r.entityId.slice(0, 8)}
                    </td>
                    <td className="px-3 py-3 text-xs text-text-muted">
                      {r.beforeJson || r.afterJson ? (
                        <span>
                          {r.beforeJson && <span>өмнө: {r.beforeJson} </span>}
                          {r.afterJson && <span>дараа: {r.afterJson}</span>}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Өмнөх
          </Button>
          <span className="text-xs text-text-muted">
            {page} / {totalPages}
          </span>
          <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Дараах
          </Button>
        </div>
      )}
    </div>
  );
}
