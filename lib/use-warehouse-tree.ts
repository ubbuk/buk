"use client";

import { useEffect, useState } from "react";
import type { WarehouseGroup } from "./warehouse-structure";

/** The warehouse catalog from GET /api/warehouses/tree. `groups` is null while loading (or when the request failed). */
export function useWarehouseTree() {
  const [groups, setGroups] = useState<WarehouseGroup[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/warehouses/tree")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("tree"))))
      .then((data: WarehouseGroup[]) => alive && setGroups(data))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);
  return { groups, failed };
}
