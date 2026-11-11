import { z } from "zod";

const pin = z.string().regex(/^\d{4}$/, "PIN дөрөв оронтой тоо байх ёстой");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const ftItemSchema = z.object({
  name: z.string().trim().min(1, "Барааны нэрийг оруулна уу").max(300),
  techSpec: optionalText(4000),
  quantity: z.number({ invalid_type_error: "Тоо хэмжээг оруулна уу" }).positive("Тоо хэмжээ 0-с их байх ёстой").max(1e9),
  unit: z.string().trim().min(1, "Нэгжийг оруулна уу").max(30),
});

export const ftOrderSchema = z.object({
  purpose: optionalText(4000),
  items: z.array(ftItemSchema).min(1, "Хамгийн багадаа нэг бараа нэмнэ үү").max(100),
});

export const ftCreateSchema = ftOrderSchema.extend({ submit: z.boolean().optional() });
export const ftUpdateSchema = ftOrderSchema.extend({ expectedVersion: z.number().int() });
export const ftVersionSchema = z.object({ expectedVersion: z.number().int() });

export const ftQuoteSchema = z.object({
  supplierName: z.string().trim().min(1, "Нийлүүлэгчийн нэрийг оруулна уу").max(200),
  country: z.string().trim().min(1, "Улсыг оруулна уу").max(100),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Валют 3 үсэгтэй код байх ёстой (жишээ нь USD)"),
  price: z.number({ invalid_type_error: "Үнийг оруулна уу" }).positive("Үнэ 0-с их байх ёстой").max(1e12),
  shippingCost: z.number().min(0, "Тээврийн зардал сөрөг байж болохгүй").max(1e12).default(0),
  leadTimeDays: z.number().int().min(0).max(3650).nullable().optional(),
  warranty: optionalText(500),
  note: optionalText(2000),
});

export const ftShareSchema = z
  .object({ boss: z.boolean().optional(), technical: z.boolean().optional() })
  .refine((v) => v.boss || v.technical, { message: "Хэнд танилцуулахаа сонгоно уу" });

export const ftSelectionSchema = z.object({
  quoteId: z.string().min(1),
  rationale: z.string().trim().min(5, "Шийдвэрийн үндэслэлийг бичнэ үү").max(4000),
});

/** APPROVE needs the approver's PIN; RETURN needs a reason. */
export const ftDecisionSchema = z
  .object({
    action: z.enum(["APPROVE", "RETURN"]),
    pin: pin.optional(),
    reason: z.string().trim().max(2000).optional(),
    expectedVersion: z.number().int(),
  })
  .superRefine((v, ctx) => {
    if (v.action === "APPROVE" && !v.pin) ctx.addIssue({ code: "custom", path: ["pin"], message: "PIN оруулна уу" });
    if (v.action === "RETURN" && !v.reason) ctx.addIssue({ code: "custom", path: ["reason"], message: "Буцаах шалтгаанаа бичнэ үү" });
  });

export const FT_MESSAGE_MAX = 4000;
