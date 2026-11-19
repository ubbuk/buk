import { describe, expect, it } from "vitest";
import { canonicalEmail, emailProblem, emailSchema, EMAIL_CYRILLIC_MESSAGE, EMAIL_INVALID_MESSAGE } from "./email";

const message = (v: unknown) => {
  const r = emailSchema.safeParse(v);
  return r.success ? null : r.error.issues[0].message;
};

describe("canonicalEmail", () => {
  it("trims, lower-cases, applies NFKC and drops invisible characters", () => {
    expect(canonicalEmail("  Uugantsetseg@Gmail.COM ")).toBe("uugantsetseg@gmail.com");
    expect(canonicalEmail("uugantsetseg@gmail.com ")).toBe("uugantsetseg@gmail.com"); // NBSP from a phone keyboard
    expect(canonicalEmail("uugantsetseg​@gmail.com")).toBe("uugantsetseg@gmail.com"); // zero-width space from a paste
    expect(canonicalEmail("﻿uugantsetseg@gmail.com")).toBe("uugantsetseg@gmail.com"); // BOM
    expect(canonicalEmail("ａdmin＠test.local")).toBe("admin@test.local"); // full-width forms
  });
});

describe("the e-mail schema", () => {
  it("accepts ordinary Latin addresses and returns the canonical form", () => {
    expect(emailSchema.parse("uugantsetseg@gmail.com")).toBe("uugantsetseg@gmail.com");
    expect(emailSchema.parse(" Hash@Gmail.com ")).toBe("hash@gmail.com");
    expect(emailSchema.parse("first.last+tag@sub.example.co")).toBe("first.last+tag@sub.example.co");
    expect(emailSchema.parse("o'brien@example.com")).toBe("o'brien@example.com");
  });

  it("says plainly when Cyrillic letters sneaked in (у е а с о р х look Latin)", () => {
    expect(message("уugantsetseg@gmail.com")).toBe(EMAIL_CYRILLIC_MESSAGE); // у
    expect(message("uugantsetsеg@gmail.com")).toBe(EMAIL_CYRILLIC_MESSAGE); // е
    expect(message("uugantsetseg@gmаil.com")).toBe(EMAIL_CYRILLIC_MESSAGE); // а in the domain
    expect(message("бат@gmail.com")).toBe(EMAIL_CYRILLIC_MESSAGE);
    expect(emailProblem("уugantsetseg@gmail.com")).toBe("cyrillic");
  });

  it("gives one generic sentence for everything else", () => {
    for (const bad of ["", "plain", "no-at.com", "a@b", "a@@b.com", "a b@gmail.com", "a@gmail,com", "a@gmail..com", ".a@gmail.com", "a@-gmail.com", "a@gmail.c", "a@gmail.com.", "üser@gmail.com", `${"x".repeat(250)}@gmail.com`]) {
      expect(message(bad), JSON.stringify(bad)).toBe(EMAIL_INVALID_MESSAGE);
    }
    expect(message(undefined)).toBe(EMAIL_INVALID_MESSAGE);
    expect(message(42)).toBe(EMAIL_INVALID_MESSAGE);
  });

  it("puts only a reason code, never the address, on the issue", () => {
    const r = emailSchema.safeParse("у@gmail.com");
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify((r.error.issues[0] as { params?: unknown }).params)).toBe('{"reason":"cyrillic"}');
    }
  });
});
