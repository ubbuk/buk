import bcrypt from "bcrypt";

// Test support for the admin routes that grant authority (lib/authority-grant.ts): they need the administrator
// own password, a reason and a confirmation. Not a test file itself.

export const ADMIN_TEST_PASSWORD = "Admin-test-pass-1";
export const ADMIN_TEST_HASH = bcrypt.hashSync(ADMIN_TEST_PASSWORD, 4);

/** Adds the step-up fields a grant needs; anything in `body` wins, so a test can blank one to prove it is required. */
export const withStepUp = <T extends object>(body: T) => ({ adminPassword: ADMIN_TEST_PASSWORD, reason: "Тестийн шалтгаан", confirmed: true, ...body });
