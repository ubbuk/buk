"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, Warehouse as WarehouseIcon } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import { useWarehouseTree } from "@/lib/use-warehouse-tree";
import { PrintButton } from "@/components/ui/PrintButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonTable } from "@/components/ui/Skeleton";

export default function WarehousesPage() {
  const { groups, failed } = useWarehouseTree();
  // null = the user has not picked one yet: the first group is open by default
  const [pickedId, setPickedId] = useState<string | null | undefined>(undefined);
  const expandedId = pickedId === undefined ? groups?.[0]?.id ?? null : pickedId;
  const setExpandedId = setPickedId;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-text">Агуулахын жагсаалт</h2>
        <PrintButton />
      </div>

      {failed && <EmptyState title="Агуулахын жагсаалтыг ачаалж чадсангүй" description="Хуудсыг дахин ачаалж үзнэ үү" />}
      {!failed && !groups && <SkeletonTable />}

      <div className="space-y-3">
        {(groups ?? []).map((group) => {
          const expanded = expandedId === group.id;
          return (
            <Card key={group.id}>
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? null : group.id)}
                className="focus-ring flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
              >
                <span className="text-sm font-semibold text-text">{group.name}</span>
                <span className="flex items-center gap-2 text-xs text-text-muted">
                  {group.keeperName ? `Нярав: ${group.keeperName} · ` : "Нярав байхгүй · "}
                  {group.warehouses.length} агуулах
                  <ChevronDown
                    className={cn("size-4 transition-transform", expanded && "rotate-180")}
                  />
                </span>
              </button>

              {expanded && (
                <CardBody className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-4">
                  {group.warehouses.map((wh) => (
                    <Link
                      key={wh.id}
                      href={`/warehouses/${group.id}/${wh.id}`}
                      className="focus-ring group flex flex-col gap-2 rounded-lg border border-border bg-bg-elevated p-4 transition-colors hover:border-accent/40 hover:bg-bg-elevated/70"
                    >
                      <div className="flex size-9 items-center justify-center rounded-lg bg-accent/15 text-accent">
                        <WarehouseIcon className="size-4" />
                      </div>
                      <span className="text-sm font-medium text-text">{wh.name}</span>
                      <span className="text-xs text-text-muted">
                        {wh.categories.map((c) => c.name).join(", ")}
                      </span>
                    </Link>
                  ))}
                </CardBody>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
