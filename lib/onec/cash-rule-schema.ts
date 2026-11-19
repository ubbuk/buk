import { z } from "zod";
import { CATEGORY_IDS, RULE_DIRECTIONS, RULE_FIELDS } from "./cash-categories";

// Ангиллын дүрмийн оролт (admin API): алдаа бүр юу буруу болохыг хэлнэ.
export const ruleSchema = z.object({
  direction: z.enum(RULE_DIRECTIONS, { errorMap: () => ({ message: "Чиглэл буруу байна" }) }),
  field: z.enum(RULE_FIELDS, { errorMap: () => ({ message: "Юуг шалгахыг сонгоно уу" }) }),
  pattern: z.string({ required_error: "Агуулсан үгийг оруулна уу" }).trim().min(1, "Агуулсан үгийг оруулна уу").max(80, "Хэт урт байна (80 тэмдэгтээс ихгүй)"),
  category: z.enum(CATEGORY_IDS, { errorMap: () => ({ message: "Ангилал буруу байна" }) }),
  priority: z.number({ invalid_type_error: "Эрэмбэ тоо байх ёстой" }).int("Эрэмбэ бүхэл тоо байх ёстой").min(-1000).max(10000).default(100),
  isActive: z.boolean().default(true),
  note: z.string().trim().max(200, "Тайлбар хэт урт байна").nullable().optional(),
});
