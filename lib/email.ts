import { z } from "zod";

// E-mail addresses typed or pasted by an administrator. The account is later found by the login with a case-insensitive,
// NFKC-normalised match (lib/auth.ts), so what is stored must already be in that canonical form: lower case, no
// surrounding or invisible characters. Anything that is not plain Latin is refused with a sentence that says why.

// Characters that never belong in an address and that no keyboard shows: zero-width space/joiners, word joiner, BOM.
const INVISIBLE = /[​-‍⁠﻿]/g;
const CYRILLIC = /[Ѐ-ӿ]/;
const ADDRESS = /^[a-z0-9._%+'-]+@([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

export const EMAIL_CYRILLIC_MESSAGE = "И-мэйл хаягт кирилл үсэг орсон байна, латин гараар бичнэ үү";
export const EMAIL_INVALID_MESSAGE = "И-мэйл хаяг буруу байна (латин үсэг, зайгүй)";

/** trim + NFKC + lower case (+ drop invisible characters): the one form that is stored and compared. */
export function canonicalEmail(raw: string): string {
  return raw.replace(INVISIBLE, "").normalize("NFKC").trim().toLowerCase();
}

/** Why `raw` is not an acceptable address ("cyrillic" | "invalid"), or null. Never returns the value itself. */
export function emailProblem(raw: string): "cyrillic" | "invalid" | null {
  const email = canonicalEmail(raw);
  // Cyrillic is checked first: у, е, а, с, о, р, х look exactly like Latin letters, so "invalid" would be baffling.
  if (CYRILLIC.test(email)) return "cyrillic";
  if (email.length > 254 || email.includes("..") || email.startsWith(".") || !ADDRESS.test(email)) return "invalid";
  return null;
}

/** Validates and canonicalises in one step. The issue carries a `reason` param (no value) for the server log. */
export const emailSchema = z
  .string({ required_error: EMAIL_INVALID_MESSAGE, invalid_type_error: EMAIL_INVALID_MESSAGE })
  .superRefine((raw, ctx) => {
    const problem = emailProblem(raw);
    if (problem) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem === "cyrillic" ? EMAIL_CYRILLIC_MESSAGE : EMAIL_INVALID_MESSAGE, params: { reason: problem } });
    }
  })
  .transform(canonicalEmail);
