# Security stages 2 and 4: sessions, administrator rules, self-service recovery

Status: implemented and tested on branch `security/stage2-4-hardening` (based on `release/profile-security` `f518643`). **Not committed to a release branch, not deployed, no production migration run.** The Vanilla.js Dashboard was not read, searched, or touched; section 6 is an interface document only.

The deployment keeps **one ADMIN**.

**Policy (corrected).** The administrator grants authority **directly**: role changes (BOSS, DIRECTOR, MANAGER and the other allowed roles), department head, approval and procurement positions, and creating users. A grant is protected by the Stage 1.5 guard only: the administrator's own password, a reason, a confirmation, a rate limit, a before/after audit and notifications written in the same transaction as the change, and the custody check. **There is no executive-director approval step, queue, page or table.** An earlier iteration of this branch added one (a "Stage 3 dual control"); it was removed because it was not the intended policy. The executive director takes part only in the existing purchase-order approval workflow, and is merely *notified* of grants like the other administrators.

## 1. Stage 2: session revocation

**Problem found.** Sessions are JWTs (NextAuth default lifetime 30 days). Changing a password did not end any session; deactivating and re-activating an account brought its old tokens back; a deactivated user's request still produced a session object with an empty role, which routes that only check "is there a session" accepted.

**What exists now**
- `User.sessionVersion` (int, default 0) and `User.passwordChangedAt`. A token carries the version it was issued under (`sv`). The `jwt` callback (`lib/auth.ts`) compares it with the database on every request (through the existing 5 second in-process cache) and treats a mismatch, an unknown account or an inactive account as revoked.
- A revoked session is **no session**: the `session` callback returns an empty object, which `getServerSession` turns into `null`, so every route that only asks "is there a session" refuses it too.
- Revoking events (`lib/session-revocation.ts`, committed in the **same transaction** as the change): the owner changes their password (their own session ends too; the Settings page signs out), an administrator resets a password, an account is deactivated, recovery completes, an administrator signs an account out of every device (`POST /api/admin/users/[id]/revoke-sessions`, with the administrator's own password and a reason, audited, the account notified).
- Lifetime: 12 hours, sliding (re-issued at most once an hour while in use) instead of 30 days.
- The `(app)` layout re-validates the session against the database on every full page load, so a direct URL never shows the application shell to a revoked session.
- Tokens issued before this release carry no `sv` and count as generation 0: **nobody is signed out by deploying it**.

**Limits.** The 5 second cache is per serverless instance: the instance that made the change forgets at once, another instance can accept a revoked token for up to 5 seconds. The administrator revokes their own sessions by changing their password. Per-device session listing is not built.

## 2. Administrator rules kept from the hardening work

Besides the Stage 1 / 1.5 guard (unchanged), three rules were added and stay:
1. **The ADMIN role cannot be granted or created through the application** (`ADMIN_ROLE_LOCKED`): this deployment keeps one administrator. A second one can only come from the documented break-glass procedure.
2. **The last active administrator cannot be demoted or deactivated** (`LAST_ADMIN`).
3. **Nobody grants authority to themselves** (`SELF_GRANT_FORBIDDEN`).

Everything else about granting is the Stage 1.5 behaviour described in `docs/admin-credential-security.md`. In particular the custody check is a barrier and a detector, **not** a guarantee: an administrator who knows a temporary password can sign in as the employee, change it, and then grant (a test documents it).

## 3. Stage 4: self-service recovery architecture (prepared, OFF)

The server side is complete and tested but **inert**: it needs `SELF_SERVICE_RECOVERY=on` **and** a delivery channel registered with `setRecoveryDelivery()` in `lib/password-recovery.ts`. No mail provider is bundled and none was added; choosing one is a decision for you (section 7).

- `POST /api/auth/recovery/request` (public): same answer whether or not the address exists; throttled per hashed address and per IP.
- `POST /api/auth/recovery/confirm` (public): token + new password. Tokens are 256 random bits, stored only as a hash, valid 30 minutes, single use, a new request voids older ones; throttled per address and per token.
- Completing it sets the owner's own password, revokes every session, records an audit entry that counts as the owner's own password change, and notifies the owner.
- **ADMIN and every account that carries authority are excluded**: they get no token (same answer, no mail), and a token issued to an account that gained authority afterwards stops working. They recover through Settings or the break-glass procedure. A mailbox alone must not be enough to take over such an account.
- Once ready, the Stage 1 administrator temporary-password reset is refused (`USE_SELF_SERVICE_RECOVERY`): the administrator is out of the recovery path for ordinary accounts.
- Not built: the browser pages for "forgot password" and "set a new password", the mail adapter, and the replacement of temporary passwords on user creation by an invitation link.

## 4. Direct URL access

- `middleware.ts` + `lib/route-access.ts`: a typed or bookmarked URL needs a session with a role, and `/admin`, `/accounting`, `/procurement` need their roles. `/admin/monitoring` (Time Machine) is left to its own server gate, which audit-logs a denied attempt.
- The middleware only decodes the cookie. Real enforcement: the `(app)` layout (database re-validation) and every API route.
- `lib/route-access.test.ts` enumerates **every** route handler from the file system and proves that each answers 401/403 with no session and that each `/api/admin` handler answers 403 to an ordinary employee; a source guard fails the build if a new route file does not ask for the session.

## 5. Behaviour changes to announce

- Changing your password signs you out everywhere, including the device you used. After deploy, nobody is signed out.
- Sessions last at most 12 hours of inactivity (was 30 days).
- The ADMIN role is no longer offered or accepted; the last administrator cannot be demoted or deactivated; an administrator cannot grant authority to themselves.
- Granting authority is otherwise as in Stage 1.5: the administrator's own password, a reason and a confirmation, and it takes effect at once.

## 6. Future Dashboard integration

See `docs/dashboard-integration-interface.md`. Nothing is implemented and the other repository was not accessed.

## 7. Residual risk (honest)

| Risk | Level | Notes |
| --- | --- | --- |
| ADMIN impersonation | **HIGH** | With one administrator and direct grants, a compromised or malicious administrator can still take over an ordinary employee (reset, learn the temporary password, change it as them, then grant) or create a privileged account they know the password of. The guard makes this slower, attributable and visible through notifications; it does not prevent it. Dual control, a second administrator, or enabling Stage 4 for ordinary accounts would reduce it; none is in place. |
| Database owner / Vercel owner | HIGH | Outside application control: they can edit the database or rotate secrets. Break-glass exists for them to act openly. |
| Per-instance 5 s cache | LOW | A revoked token may work up to 5 seconds on another instance. |
| No second factor | MEDIUM | Passwords only (PIN is for approvals, not sign-in). |
| Recovery e-mail channel | MEDIUM when enabled | A mailbox compromise opens ordinary accounts; privileged ones are excluded. |
| Notifications must be read | MEDIUM | The controls are only as good as the person who reads the notification. |

## 8. Decisions and actions that need your approval

1. Committing this branch, merging it, deploying it, and running the migrations in production (migrations first).
2. Choosing an e-mail provider for self-service recovery (a new external service), and the follow-up work for the pages.
3. Whether to add a second factor for the administrator, and whether any extra control on grants is wanted later (that would be a new decision, not part of this branch).

## 9. Migrations added by this branch (in order)

1. `20261110090000_add_session_version`: `User.sessionVersion`, `User.passwordChangedAt`.
2. `20261110110000_add_password_recovery_token`: table `PasswordRecoveryToken` (unused until recovery is enabled).

The branch's earlier approval-queue migration was deleted before it was ever committed or applied anywhere outside isolated test databases.
