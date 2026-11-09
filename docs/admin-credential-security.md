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


---

# Stage 1.5: granting authority goes through one guard

Stage 1 stopped an ADMIN from resetting the password of an account that already carries authority. It left a two-step route open: reset a plain employee (the administrator learns the temporary password), raise that employee's role or appoint them to a position, then sign in as them. Stage 1.5 closes the "grant" transitions. **No schema change, no migration, no new service.**

## Inventory: every way authority is granted

| Endpoint | What it grants | Guard (all go through `lib/authority-grant.ts`) |
| --- | --- | --- |
| `PATCH /api/admin/users/[id]` | role to any role except EMPLOYEE (ADMIN included); re-activating an account that carries a privileged role or kept an approval position | step-up + custody; plain changes (title, department, demotion, ordinary re-activation) unchanged |
| `POST /api/admin/approval-roles` | the 8 approval positions (incl. both procurement managers) | step-up + custody + position eligibility (server-side); naming the current holder is a no-op |
| `PATCH /api/admin/departments/[id]` | department head | step-up + custody for a different, non-null head; clearing or repeating the head needs nothing |
| `POST /api/admin/procurement-handover` | a procurement position and its unfinished items | step-up + custody (reason already existed) |
| `POST /api/admin/users` | a new account with a privileged role | reason + confirmation + own password; admin-issued by definition, so no custody check; EMPLOYEE creation unchanged |

Roles: EMPLOYEE is the only role without privileges; BOSS, DIRECTOR, MANAGER, STOREKEEPER, ENGINEERING, CHIEF_ACCOUNTANT and ADMIN are privileged. Not grants (and unchanged): password reset (Stage 1), PIN reset, deactivation, deletion, `PATCH` of a title or department.

## What a grant now requires

1. An **active ADMIN in the database** right now (not a session claim).
2. The administrator's **own password**, a **reason** (3-500 characters) and an explicit **confirmation** (`adminPassword`, `reason`, `confirmed: true`); otherwise `400 STEP_UP_REQUIRED` and nothing changes.
3. The shared PostgreSQL **rate limit**: 20 grant attempts per administrator per 15 minutes, every attempt counted, failed or not; an unavailable limiter refuses the grant (503).
4. **Custody evidence** for an existing account (below): otherwise `409 CREDENTIAL_NOT_OWNER_HELD`.
5. For a position or department head: the candidate must be **eligible** (active, and the role the position needs). This used to be enforced only by the screen.

When it succeeds, in the **same transaction** as the change: a before/after audit row (`entityType AuthorityGrant`: actor, address, kind, reason, confirmation, subject, before, after, custody state; never a password or hash) and notifications to the person, to the previous holder, to every other active ADMIN and to the current executive director (the acting administrator is not notified). If the audit row or a notification cannot be written, **the grant does not happen** (500, "nothing changed").

## Custody evidence: a barrier and a detector, not a guarantee

The latest *issue event* for the account is a user creation or an admin password reset carrying the Stage 1 `kind` marker. If the account itself has changed its own password since (`CHANGE_PASSWORD` with `actorId = the account`), the owner holds the credential and the grant may proceed. Issue events from before Stage 1 have no marker and are ignored. An unreadable audit log reads as UNKNOWN and refuses.

**An ADMIN can bypass this.** The administrator is shown the temporary password. They can sign in as the employee, change the password themselves and so create exactly the evidence the check looks for; `lib/authority-grant.test.ts` demonstrates it on purpose (the "KNOWN LIMITATION" test). What the guard does achieve without dual control: the bypass is slower, needs the employee's real login, cannot happen in one API call, and always leaves a trail: the creation, the password change from the employee's own session, the grant with its reason, the notification to the employee (who did not know) and to every other administrator and the executive. **It must not be described as preventing impersonation.** Only Stage 3 (a second approver) or Stage 4 (the administrator never learns a password) prevents it.

## Behaviour changes (API contract)

- Role elevation, re-activation of a privileged account, position assignment, department head, handover and privileged user creation now need `adminPassword`, `reason`, `confirmed`. The admin screen asks for them in a dialog (or inline when creating a user). Other clients must send them.
- A newly created or reset account must have its **owner change the password** (Settings) before it can receive a position, department head or a role elevation. Onboarding order: create as EMPLOYEE, the person signs in and changes the password, then grant.
- Creating a user with a privileged role is allowed (step-up + notifications), but such an account cannot then receive a position until its owner has changed the password.
- Positions can no longer be given to someone who lacks the matching role or is inactive, even by calling the API directly.
- Admin password-change and Stage 1 audit rows now record the client address (`ipAddress`, respecting `TRUSTED_PROXY`).

## ADMIN-to-ADMIN reset: unchanged for now, read-only plan first

Resetting one administrator's password by another is still allowed (Stage 1 only refuses approval-capable accounts, and ADMIN is not one). Before changing that, find out whether it can be done safely. Read-only checks, in this order, **on a copy or with a read-only role, never writing**:

1. How many active ADMIN accounts exist: `SELECT count(*) FROM "User" WHERE role = 'ADMIN' AND "isActive";`. With one administrator, "an admin cannot reset an admin" would lock the system out.
2. Whether each administrator is also a position holder or department head (they are then approval-capable under Stage 1 and are already not resettable): `SELECT u.email FROM "User" u JOIN "ApprovalRoleAssignment" a ON a."userId" = u.id AND a."isActive" WHERE u.role = 'ADMIN';`.
3. `lastLoginAt` of each administrator, to see who can still sign in and change their own password.
4. What recovery exists if the only administrators are locked out: a database-owner procedure (written request, two named authorisers, change log), tested in a **non-production** copy first.

Only when there are at least two administrators who can sign in and a tested recovery path should ADMIN-to-ADMIN reset be refused (or made to need a second administrator). That change is Stage 3.

## Residual impersonation risk if released without Stage 3 / Stage 4

Honest assessment for a malicious or compromised administrator:

- **Still possible**: take over an *ordinary* employee (reset, learn the temporary password), have them change the password as themselves, then grant that identity a role or position. It needs several steps, the employee's real account, a reason on record, and it notifies the employee, every other administrator and the executive. It is **detectable and attributable, not prevented**.
- **Still possible**: create an account with a privileged role directly (reason + confirmation + notifications); the administrator knows its password.
- **Still possible**: reset another administrator (see above).
- **Not covered**: sessions are not revoked when a password changes, so a replaced password does not end an open session; the audit log is ordinary data that a database owner can edit; a self-grant (an administrator granting something to themselves) is allowed but notified.
- **Closed**: the one-call takeover of an approver; granting authority by a session-only claim; granting without the administrator's own password, a reason and a record; granting to an ineligible holder; silent grants (nobody was told).

For a real fix: Stage 2 (`mustChangePassword`, expiring temporary passwords, session revocation), Stage 3 (dual control), Stage 4 (employee-owned recovery link). Until then, treat the notifications as the control that matters: someone must read them.
