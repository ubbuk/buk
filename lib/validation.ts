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
  unitPrice: z
    .number({ invalid_type_error: "Нэгж үнийг оруулна уу" })
    .min(0, "Нэгж үнэ сөрөг байж болохгүй"),
  note: z.string().optional(),
});

export const materialRequestFormSchema = z.object({
  departmentId: z.string().min(1, "Цех, тасгийн нэрийг сонгоно уу"),
  route: z.enum(["OFFICE", "FACTORY"], { required_error: "Чиглэлийг сонгоно уу" }),
  note: z.string().optional(),
  items: z.array(materialRequestItemSchema).min(1, "Хамгийн багадаа нэг мөр нэмнэ үү"),
});

export type MaterialRequestItemInput = z.infer<typeof materialRequestItemSchema>;
export type MaterialRequestFormInput = z.infer<typeof materialRequestFormSchema>;

export type FieldErrors = Partial<Record<string, string>>;

// --- API payload schema (POST /api/requests) --------------------------------
export const apiCreateRequestItemSchema = z.object({
  materialId: z.string().nullable().optional(),
  materialName: z.string().trim().min(1),
  unit: z.string().trim().min(1),
  requestedQuantity: z.number().positive(),
  unitPrice: z.number().min(0),
  note: z.string().optional(),
});

export const apiCreateRequestSchema = z.object({
  departmentId: z.string().min(1),
  route: z.enum(["OFFICE", "FACTORY"]),
  note: z.string().optional(),
  items: z.array(apiCreateRequestItemSchema).min(1),
});

export type ApiCreateRequestInput = z.infer<typeof apiCreateRequestSchema>;

export function validateItem(item: MaterialRequestItemInput): FieldErrors {
  const result = materialRequestItemSchema.safeParse(item);
  if (result.success) return {};
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    errors[String(issue.path[0])] = issue.message;
  }
  return errors;
}
