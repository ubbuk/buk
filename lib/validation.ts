import { z } from "zod";

export const materialRequestItemSchema = z.object({
  id: z.string(),
  materialId: z.string().nullable(),
  materialName: z.string().trim().min(1, "Материалын нэрийг оруулна уу"),
  warehouseBalance: z.number().nullable(),
  unit: z.string().trim().min(1, "Нэгжийг сонгоно уу"),
  requestedQuantity: z
    .number({ invalid_type_error: "Тоо хэмжээг оруулна уу" })
    .positive("Тоо хэмжээ 0-с их байх ёстой"),
  // Optional: a request can be submitted with no price and priced in later
  // (by MANAGER). Omitted/null means "not entered" -- a real number is
  // still validated (no negatives, no non-numeric values).
  unitPrice: z
    .number({ invalid_type_error: "Нэгж үнэ тоон утга байх ёстой" })
    .min(0, "Нэгж үнэ сөрөг байж болохгүй")
    .nullable()
    .optional(),
  note: z.string().optional(),
});

export const materialRequestFormSchema = z.object({
  departmentId: z.string().min(1, "Цех, тасгийн нэрийг сонгоно уу"),
  note: z.string().optional(),
  items: z.array(materialRequestItemSchema).min(1, "Хамгийн багадаа нэг мөр нэмнэ үү"),
});

export type MaterialRequestItemInput = z.infer<typeof materialRequestItemSchema>;
export type MaterialRequestFormInput = z.infer<typeof materialRequestFormSchema>;

export type FieldErrors = Partial<Record<string, string>>;

// --- API payload schema (POST /api/requests) --------------------------------
// Branch (ENGINEERING vs OPERATIONS_DIRECTOR, stage 4) is resolved from the
// department's own type at approval time -- no requester-chosen route.
export const apiCreateRequestItemSchema = z.object({
  materialId: z.string().nullable().optional(),
  materialName: z.string().trim().min(1),
  unit: z.string().trim().min(1),
  requestedQuantity: z.number().positive(),
  unitPrice: z.number().min(0).nullable().optional(),
  note: z.string().optional(),
});

export const apiCreateRequestSchema = z.object({
  departmentId: z.string().min(1),
  note: z.string().optional(),
  items: z.array(apiCreateRequestItemSchema).min(1),
});

export type ApiCreateRequestInput = z.infer<typeof apiCreateRequestSchema>;

// --- Decision endpoint payloads (approve/return/resubmit) -------------------
export const approvalDecisionSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, "PIN дөрөв оронтой тоо байх ёстой"),
  expectedVersion: z.number().int(),
});

export const returnDecisionSchema = z.object({
  reason: z.string().trim().min(1),
  expectedVersion: z.number().int(),
});

export const resubmitDepartmentSchema = z.object({
  expectedVersion: z.number().int(),
  note: z.string().optional(),
  items: z.array(apiCreateRequestItemSchema).min(1),
});

export const resubmitPositionStepSchema = z.object({
  expectedVersion: z.number().int(),
  adjustments: z.array(z.object({ requestItemId: z.string().min(1), quantity: z.number().min(0) })).min(1),
});

export const updateItemPriceSchema = z.object({
  unitPrice: z.number().positive(),
  expectedVersion: z.number().int(),
});

export const accountingRecordSchema = z.object({
  ledgerNumber: z.string().trim().min(1, "Бүртгэлийн дугаар оруулна уу"),
  recordDate: z.string().min(1, "Огноо оруулна уу"),
  note: z.string().optional(),
  expectedVersion: z.number().int(),
});

export const registerMaterialSchema = z.object({
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  unit: z.string().trim().min(1),
  category: z.string().trim().optional(),
  defaultPrice: z.number().nonnegative(),
});

export function validateItem(item: MaterialRequestItemInput): FieldErrors {
  const result = materialRequestItemSchema.safeParse(item);
  if (result.success) return {};
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    errors[String(issue.path[0])] = issue.message;
  }
  return errors;
}
