import { Suspense } from "react";
import { MaterialRequestForm } from "@/components/requests/MaterialRequestForm";

export default function NewRequestPage() {
  return (
    <Suspense>
      <MaterialRequestForm />
    </Suspense>
  );
}
