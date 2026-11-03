"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { findWarehouseItem } from "@/lib/warehouse-structure";
import { formatNumber } from "@/lib/utils";

export default function WarehouseItemDetailPage() {
  const params = useParams<{
    groupId: string;
    warehouseId: string;
    categoryId: string;
    itemId: string;
  }>();
  const found = findWarehouseItem(params.groupId, params.warehouseId, params.categoryId, params.itemId);

  if (!found) {
    return (
      <EmptyState
        title="Бараа олдсонгүй"
        description="Энэ холбоос хүчингүй байна. Агуулахын жагсаалт руу буцна уу."
        action={
          <Link href="/warehouses" className="text-sm text-accent hover:underline">
            Агуулахын жагсаалт руу буцах
          </Link>
        }
      />
    );
  }

  const { group, warehouse, category, item } = found;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5 text-sm text-text-muted">
        <Link href="/warehouses" className="hover:text-text hover:underline">
          Агуулахын жагсаалт
        </Link>
        <ChevronRight className="size-3.5" />
        <Link href={`/warehouses/${group.id}/${warehouse.id}`} className="hover:text-text hover:underline">
          {warehouse.name}
        </Link>
        <ChevronRight className="size-3.5" />
        <span>{category.name}</span>
        <ChevronRight className="size-3.5" />
        <span className="font-medium text-text">{item.name}</span>
      </div>

      <h2 className="text-lg font-semibold text-text">{item.name}</h2>

      <Card>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs text-text-muted">Агуулах</p>
            <p className="mt-0.5 text-sm font-medium text-text">{warehouse.name}</p>
          </div>
          <div>
            <p className="text-xs text-text-muted">Ангилал</p>
            <p className="mt-0.5 text-sm font-medium text-text">{category.name}</p>
          </div>
          <div>
            <p className="text-xs text-text-muted">Үлдэгдэл (баланс)</p>
            <p className="mt-0.5 text-lg font-semibold text-text">
              {formatNumber(item.quantity)} {item.unit}
            </p>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
