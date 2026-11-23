import { z } from "zod";
import { PIN_FORMAT_ERROR, PIN_PATTERN } from "./pin-format";

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
// Every rule carries its own message: the route turns the first failure into the sentence the user sees
// (describeApiIssue), so "Хүчингүй өгөгдөл" alone never reaches the screen.
export const apiCreateRequestItemSchema = z.object({
  materialId: z.string().nullable().optional(),
  materialName: z.string({ required_error: "Материалын нэрийг оруулна уу", invalid_type_error: "Материалын нэр буруу байна" }).trim().min(1, "Материалын нэрийг оруулна уу"),
  unit: z.string({ required_error: "Нэгжийг оруулна уу", invalid_type_error: "Нэгж буруу байна" }).trim().min(1, "Нэгжийг оруулна уу"),
  requestedQuantity: z
    .number({ required_error: "Тоо хэмжээг оруулна уу", invalid_type_error: "Тоо хэмжээ тоо байх ёстой" })
    .positive("Тоо хэмжээ 0-с их байх ёстой"),
  unitPrice: z.number({ invalid_type_error: "Нэгж үнэ тоо байх ёстой" }).min(0, "Нэгж үнэ сөрөг байж болохгүй").nullable().optional(),
  note: z.string({ invalid_type_error: "Тайлбар буруу байна" }).optional(),
});

export const apiCreateRequestSchema = z.object({
  departmentId: z.string({ required_error: "Цех, тасаг сонгогдоогүй байна", invalid_type_error: "Цех, тасаг буруу байна" }).min(1, "Цех, тасаг сонгогдоогүй байна. Хуудсаа дахин ачаалж цех, тасгаа сонгоно уу"),
  note: z.string().optional(),
  items: z.array(apiCreateRequestItemSchema, { required_error: "Материалын жагсаалт хоосон байна", invalid_type_error: "Материалын жагсаалт буруу байна" }).min(1, "Хамгийн багадаа нэг мөр нэмнэ үү"),
});

const FIELD_LABEL: Record<string, string> = {
  departmentId: "Цех, тасаг",
  items: "Материалын жагсаалт",
  materialName: "Материалын нэр",
  unit: "Нэгж",
  requestedQuantity: "Тоо хэмжээ",
  unitPrice: "Нэгж үнэ",
  note: "Тайлбар",
};

/** "2-р мөр · Тоо хэмжээ: Тоо хэмжээ 0-с их байх ёстой" -- names the row and field of one zod issue. */
export function describeApiIssue(issue: { path: (string | number)[]; message: string }): string {
  const row = issue.path[0] === "items" && typeof issue.path[1] === "number" ? `${issue.path[1] + 1}-р мөр` : null;
  const field = FIELD_LABEL[String(issue.path[issue.path.length - 1])];
  return [row, field ? `${field}: ${issue.message}` : issue.message].filter(Boolean).join(" · ");
}

export type ApiCreateRequestInput = z.infer<typeof apiCreateRequestSchema>;

// --- Decision endpoint payloads (approve/return/resubmit) -------------------
export const approvalDecisionSchema = z.object({
  pin: z.string().regex(PIN_PATTERN, PIN_FORMAT_ERROR),
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

// --- Executive partial approval & deferred procurement ------------------------
const quantityItemsSchema = z.array(z.object({ itemId: z.string().min(1), quantity: z.number().positive() })).min(1);

/** POST executive-approve: `items` omitted = approve everything that needs buying. */
export const executiveApproveSchema = approvalDecisionSchema.extend({
  items: quantityItemsSchema.optional(),
  comment: z.string().trim().max(1000).optional(),
});

export const executiveDecisionSchema = z
  .object({
    action: z.enum(["APPROVE", "RETURN"]),
    pin: z.string().regex(PIN_PATTERN, PIN_FORMAT_ERROR).optional(),
    items: quantityItemsSchema.optional(),
    comment: z.string().trim().max(1000).optional(),
    deferredRequestId: z.string().min(1).optional(),
    clientRequestId: z.string().min(8).max(100),
    expectedRevision: z.number().int().min(0),
  })
  .refine((v) => v.action !== "APPROVE" || !!v.pin, { message: "PIN оруулна уу", path: ["pin"] });

export const deferredRequestSchema = z.object({
  items: quantityItemsSchema,
  reason: z.string().trim().min(1, "Шалтгаан эсвэл тайлбараа бичнэ үү").max(1000),
  clientRequestId: z.string().min(8).max(100),
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
