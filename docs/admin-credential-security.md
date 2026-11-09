# ADMIN credential management: Stage 1 hardening

Stage 1 reduces a specific risk. It does **not** eliminate it. Read "What is still not solved" before relying on it.

## The risk

Two ADMIN operations hand the administrator a working temporary password:

- `POST /api/admin/users/[id]/reset-credentials` (password reset)
- `POST /api/admin/users` (create user)

With a working password an administrator can sign in as that employee, create an approval PIN (setting a PIN needs only the account password) and act in the employee's name.

## What Stage 1 changes

| | Before | After (Stage 1) |
|---|---|---|
| Who can be reset | anyone | **never** an approval-capable account, never the administrator's own account |
| Proof required | an ADMIN session | active ADMIN in the **database**, the administrator's **own password**, a **reason** (3-500), the **identity-verified** attestation |
| Rate limit | none | 5 attempts per administrator and 3 per employee per 15 minutes, **every attempt counts** (failed ones too), shared PostgreSQL throttle, fail closed |
| Trace | `RESET_CREDENTIALS` with no detail | audit with actor, target, time, reason, attestation; **in the same transaction** as the change |
| Employee | not told | notified (existing notification system), in the same transaction |
| Create user | an ADMIN session | active ADMIN in the database, own password, rate limit (20 per 15 minutes), audit in the same transaction |

No migration and no new infrastructure: it reuses `LoginThrottle`, `AuditLog` and `Notification`.

### What "approval-capable" means

Decided from the database on every request (`lib/credential-guard.ts`), not from a list of role names alone:

1. **Role**: any role other than `EMPLOYEE` and `ADMIN` (BOSS, DIRECTOR, STOREKEEPER, ENGINEERING, CHIEF_ACCOUNTANT, MANAGER, and any role added later: new roles are protected by default).
2. **Department head**: `Department.headId` (department-head approval is authorised by that field, whatever the user's role is).
3. **Position**: an active `ApprovalRoleAssignment` (branch, finance, executive, storekeeper, accountant, procurement-manager positions).
4. **Open approval step** assigned to the user.
5. **Procurement items** assigned to the user.

Whether the account is active does not matter: a deactivated account that still holds an assignment is protected. If the database cannot answer, the account is treated as approval-capable and the reset is refused (HTTP 403, never "allowed on a guess"). The check runs again inside the transaction that changes the password.

Not covered: another **ADMIN** can have their password reset by an administrator (an ADMIN already has these powers). The check-then-update is not locked against a concurrent assignment: an assignment granted in the same few milliseconds as a reset can be missed (the in-transaction re-check narrows this window).

### Audit and notification

- Success: `AuditLog` action `RESET_CREDENTIALS`, `afterJson = { kind: "PASSWORD_RESET", reason, identityVerified: true, targetUserId }`. User creation: `CREATE_USER` with `{ kind: "USER_CREATE", role, departmentId, roleCarriesAuthority }`. Never a password, a hash, a PIN or a token.
- Refusals that got past the rate limiter (approval-capable target, wrong administrator password, unknown user) leave one bounded audit row each (`REJECT`, entity type `UserCredentialReset`, `kind: PASSWORD_RESET_REFUSED`, a reason code), so at most the rate limit's few rows per administrator and window can ever be written. Earlier refusals (malformed request, not an administrator, own account) are only written to the application log (`[admin] credential reset refused code=...`), which keeps the audit table from becoming a flood target.
- Failure behaviour: if the audit entry or the notification cannot be written, **the whole reset is rolled back** (password unchanged, HTTP 500, no temporary password returned). A credential change is never left untraced. The rate-limit units of that attempt stay spent.
- The employee's notification states that an administrator reset the password, when, and what to do if they did not ask for it. It never contains the temporary password.

## What is still not solved

1. **The administrator still learns the temporary password** of every account this endpoint is allowed to reset (non-approval accounts) and of every account created through `POST /api/admin/users`. They can use it. Stage 1 makes this rarer, requires proof, and leaves a trace.
2. **Accounts created with an authority-carrying role** (for example DIRECTOR) are not blocked; the administrator knows their first password until the employee changes it, and the system cannot force that change (no `mustChangePassword` flag without a schema change). `roleCarriesAuthority` in the audit entry marks these creations for review.
3. **Existing sessions are not revoked** when a password changes (no `passwordChangedAt` / token version).
4. The administrator's attestation that the employee's identity was verified is a declaration; the system cannot verify it. It is recorded.
5. The administrator can still change roles and assign approval positions to accounts they control. That is an inherent ADMIN power, not a credential-handoff problem.

## Recovering a legitimately locked-out approver

There is deliberately **no in-application bypass and no "break-glass" endpoint**. Approval-capable accounts are not reset with a temporary password.

Today:

1. If the approver can still sign in, they change their own password in Settings (current password required; guessing is rate limited).
2. If they cannot sign in at all, recovery is an **organisational procedure outside the application**: a written request, authorised by two named people who are not the requester and not the administrator performing it (for example the executive director and the head of IT), performed by the database owner, recorded in the change log. This is a stop-gap, not a feature.

Planned secure recovery (needs approval; each step is separate work):

- **Stage 2** (schema): `mustChangePassword`, `passwordChangedAt` and a temporary-password expiry; temporary passwords only open a "set a new password" screen; sessions revoked on password change.
- **Stage 3** (schema): dual control: a reset of an approval-capable account is requested by one administrator and approved by a **different** one (or by an executive), with a delay and notifications to all administrators and to the employee.
- **Stage 4** (new service): a one-time reset link sent to the employee's verified e-mail; the administrator never sees any password, and the temporary-password code is removed.
