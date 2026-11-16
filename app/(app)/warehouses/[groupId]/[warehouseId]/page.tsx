"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { ChevronRight, PackageOpen } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { findSubWarehouse } from "@/lib/warehouse-structure";
import { useWarehouseTree } from "@/lib/use-warehouse-tree";

export default function WarehouseDetailPage() {
  const params = useParams<{ groupId: string; warehouseId: string }>();
  const { groups, failed } = useWarehouseTree();
  if (!groups && !failed) return <SkeletonTable />;
  const found = groups ? findSubWarehouse(groups, params.groupId, params.warehouseId) : null;

  if (!found) {
    return (
      <EmptyState
        title="Агуулах олдсонгүй"
        description="Энэ холбоос хүчингүй байна. Агуулахын жагсаалт руу буцна уу."
        action={
          <Link href="/warehouses" className="text-sm text-accent hover:underline">
            Агуулахын жагсаалт руу буцах
          </Link>
        }
      />
    );
  }

  const { group, warehouse } = found;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1.5 text-sm text-text-muted">
        <Link href="/warehouses" className="inline-flex items-center hover:text-text hover:underline max-md:min-h-11">
          Агуулахын жагсаалт
        </Link>
        <ChevronRight className="size-3.5" />
        <span>{group.name}</span>
        <ChevronRight className="size-3.5" />
        <span className="font-medium text-text">{warehouse.name}</span>
      </div>

      <h2 className="text-lg font-semibold text-text">{warehouse.name}</h2>

      <Card>
        <CardBody className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-text-muted">Бүлэг</p>
            <p className="mt-0.5 text-sm font-medium text-text">{group.name}</p>
          </div>
          <div>
            <p className="text-xs text-text-muted">Нярав</p>
            <p className="mt-0.5 text-sm font-medium text-text">{group.keeperName ?? "Нярав байхгүй"}</p>
          </div>
          <div>
            <p className="text-xs text-text-muted">1С складын код</p>
            <p className="mt-0.5 text-sm font-medium text-text">{warehouse.onecCode ?? "—"}</p>
          </div>
        </CardBody>
      </Card>

      <EmptyState
        icon={PackageOpen}
        title="Бараа материал бүртгэгдээгүй байна"
        description="Энэ агуулахад материал бүртгэгдэх үед жагсаалт энд харагдана"
      />
    </div>
  );
}
