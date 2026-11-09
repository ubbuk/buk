import { invalidate } from "./cache";
import { userSessionCacheKey } from "./auth";

// Session revocation (Stage 2). A session is a JWT; it carries the credential generation (`sv`) the account had when it
// was issued. Every change of credentials (own password change, administrator or recovery reset, deactivation, an explicit
// "sign out everywhere") bumps `User.sessionVersion`, and the jwt callback in lib/auth.ts treats a token whose `sv` no longer
// matches as revoked on its next request. Deactivating and re-activating an account therefore no longer brings old tokens
// back, which it used to.
//
// Spread this into the SAME `user.update` that changes the credential, so the change and the revocation commit together:
//   tx.user.update({ where: { id }, data: { passwordHash, ...credentialChange() } })
// and call `forgetSession(id)` after the commit.
//
// Limits, stated plainly: the jwt callback reads the version through a 5 second in-process cache (lib/cache.ts). On the
// instance that made the change the cache is dropped at once; another serverless instance can still accept an old token for
// up to that TTL. A session whose cookie was copied BEFORE a revocation is revoked as well (that is the point); one copied
// after the account owner signed in again is a valid session like any other.
export function credentialChange(): { passwordChangedAt: Date; sessionVersion: { increment: number } } {
  return { passwordChangedAt: new Date(), sessionVersion: { increment: 1 } };
}

/** Revocation without a password change (deactivation, "sign out everywhere"). */
export function sessionRevocation(): { sessionVersion: { increment: number } } {
  return { sessionVersion: { increment: 1 } };
}

/** After the commit: drop this instance's cached view of the account so the revocation is immediate here. */
export function forgetSession(userId: string) {
  invalidate(userSessionCacheKey(userId));
}
