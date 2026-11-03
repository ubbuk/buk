import { randomBytes } from "node:crypto";

/** A random, human-typeable temporary password — shown once to the admin, never stored in plaintext. */
export function generateTempPassword(): string {
  return randomBytes(9).toString("base64url");
}
