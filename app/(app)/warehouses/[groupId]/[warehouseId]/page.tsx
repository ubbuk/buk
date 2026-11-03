"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { ChevronRight, PackageOpen } from "lucide-react";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { findSubWarehouse } from "@/lib/warehouse-structure";
import { formatNumber } from "@/lib/utils";

export default function WarehouseDetailPage() {
  const params = useParams<{ groupId: string; warehouseId: string }>();
  const found = findSubWarehouse(params.groupId, params.warehouseId);

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
        <Link href="/warehouses" className="hover:text-text hover:underline">
          Агуулахын жагсаалт
        </Link>
        <ChevronRight className="size-3.5" />
        <span>{group.name}</span>
        <ChevronRight className="size-3.5" />
        <span className="font-medium text-text">{warehouse.name}</span>
      </div>

      <h2 className="text-lg font-semibold text-text">{warehouse.name}</h2>

      <div className="space-y-4">
        {warehouse.categories.map((category) => (
          <Card key={category.id}>
            <CardHeader>
              <CardTitle>{category.name}</CardTitle>
            </CardHeader>
            {category.items && category.items.length > 0 ? (
              <ul className="divide-y divide-border">
                {category.items.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={`/warehouses/${group.id}/${warehouse.id}/${category.id}/${item.id}`}
                      className="focus-ring flex items-center justify-between gap-3 px-5 py-3 text-sm transition-colors hover:bg-bg-elevated"
                    >
                      <span className="text-text">{item.name}</span>
                      <span className="flex items-center gap-2 text-text-muted">
                        {formatNumber(item.quantity)} {item.unit}
                        <ChevronRight className="size-3.5" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={PackageOpen}
                title="Бараа материал бүртгэгдээгүй байна"
                description="Энэ ангилалд материал нэмэгдэх үед жагсаалт энд харагдана"
              />
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
