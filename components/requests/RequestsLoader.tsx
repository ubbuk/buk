"use client";

import { useEffect } from "react";
import { useRequestStore } from "@/lib/store";

export function RequestsLoader() {
  const loadRequests = useRequestStore((s) => s.loadRequests);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  return null;
}
