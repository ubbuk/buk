import { z } from "zod";

const text = z.string().min(1).max(300);

export const declaredFilesSchema = z
  .array(
    z.object({
      fileName: text,
      mimeType: z.string().min(1).max(120),
      sizeBytes: z.number().int().nonnegative(),
      thumbSizeBytes: z.number().int().positive().optional(),
    })
  )
  .min(1)
  .max(20);

export const uploadedRefsSchema = z
  .array(
    z.object({
      fileName: text,
      key: z.string().min(1).max(300),
      token: z.string().min(1).max(1000),
      thumbKey: z.string().min(1).max(300).optional(),
      thumbToken: z.string().min(1).max(1000).optional(),
    })
  )
  .min(1)
  .max(20);
