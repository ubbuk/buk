# УБ БҮК ХК — Худалдан авалтын систем (Industrial Procurement ERP)

Digitizes Улаанбаатар БҮК ХК's paper-based material requisition process
(Маягт №1): request → department head approval → warehouse verification
(partial allocation) → OFFICE/FACTORY route approval → director approval →
procurement → fulfillment.

## Status

Greenfield build (the working directory was empty when this started).

**Real, database-backed and tested end-to-end, for the full pipeline:**
- Authentication (NextAuth, credentials provider, bcrypt-hashed passwords,
  seeded users with real roles) — see `prisma/seed.ts` for accounts.
- Middleware gating every app route behind login (`middleware.ts`).
- Material request creation (`POST /api/requests`) — resolves against the
  real `Material` catalog, snapshots the live stock balance, resolves the
  department head / warehouse clerk / route approver / director from the
  database (never hardcoded names), issues a real sequential request
  number, writes an audit log entry and a notification.
- Department-head approval/return, warehouse stock verification (with real
  concurrency-safe stock reservation/issuance), OFFICE/FACTORY route
  approval/return, director approval/return, purchase-order creation, and
  goods receipt against purchase orders — all in `lib/workflow.ts`, all
  authorized against real user ids (never name/role matching), all atomic
  (conditional updates guard against double-approval and concurrent
  over-allocation of the same stock), all writing `ApprovalAction` +
  `AuditLog` + `Notification` rows.
- Dashboard low-stock alerts, the procurement queue, and the reports page
  all read real data (`GET /api/materials`, `GET /api/procurement`, the
  live request list) — no fixtures left in any screen that shows business
  data.

**Also real, database-backed and tested** (this pass):
- **Four-digit approval PIN** (`lib/pin.ts`, `ApprovalPinCredential`) —
  bcrypt-hashed, self-service setup/change behind step-up password
  re-auth (`POST /api/me/pin`), required on every approve-type decision
  (department head, warehouse check, route, director — not on returns,
  which already require a written reason). 5 wrong attempts locks the
  account for 15 minutes; failures and lockouts are audit-logged with no
  PIN value ever stored, logged, or exposed through any API response.
- **Document-version staleness checks** — `MaterialRequestView.version` is
  now sent to the client and must be echoed back on every decision;
  mismatches are rejected with 409 before the atomic step-claim even runs,
  independent of (and in addition to) the double-approval guard.
- **Electronic approval record** — every decision computes a SHA-256 over
  the reviewed items (`computeDocumentHash`) and stores it on
  `ApprovalAction`/`MaterialRequest`; `ApprovalTimeline` renders a
  signature block (approver, role, server timestamp, hash) for each
  approved step. Internal integrity record, not a legally recognized
  signature — same caveat the original spec called for.
- **Resubmission after a return** — department-head returns support full
  item editing (nothing downstream exists yet, so the item list can be
  freely replaced); route/director returns support adjusting or cancelling
  the still-open shortfall only (the available portion was already issued
  for real during warehouse check and can't be rewritten). Both reuse the
  existing `ApprovalStep`/`PurchaseRequirement` rows — history lives in
  `ApprovalAction`/`AuditLog`, not in those current-state rows.
- **Admin user management** (`/admin`, `ADMIN`-only) — create accounts
  (temp password shown once), edit role/department/active status, reset
  credentials or force a PIN reset, assign department heads and the
  singleton `OFFICE_APPROVER`/`FACTORY_APPROVER`/`DIRECTOR` roles. This
  replaced the Settings page's old decorative approver editor.
- **Real-time updates** — `app/api/events` (SSE) + an in-process event bus
  (`lib/events.ts`); every workflow decision and request creation signals
  it. `RequestsLoader` subscribes, reconnects with backoff, and falls back
  to 20s polling after repeated failures. The topbar bell is wired to the
  real `Notification` table.

Verified two ways:
1. Over real HTTP against the running app: every stage with the correct
   PIN, wrong PIN (401), 5-attempt lockout (423), stale version (409),
   every authorization boundary, the double-approval race guard under
   real concurrency, both resubmission paths end-to-end, admin create/
   reset-credentials/reset-PIN/role-assignment, and an SSE session
   receiving a live event triggered by a different session's action.
2. `lib/workflow.test.ts` (`npm test`) — PIN correct/wrong/lockout,
   stale-version rejection, both resubmission paths with history
   preserved, plus the prior pass's authorization/concurrency/allocation
   coverage — all run directly against the real Postgres database (no
   mocking).

**Still not real**: PDF export, QR verification, attachment upload, and
expanding the test suite toward the spec's full manual matrix (login-for-
every-role as a scripted suite, etc.).

**Also real, database-backed and tested** (final role/permission pass):
- **New role system** — `UserRole` is now `ADMIN, MODERATOR, DIRECTOR,
  BOSS, MANAGER, STOREKEEPER, WAREHOUSE, CLERK_INVENTORY,
  CLERK_WAREHOUSE_MANAGER, PROCUREMENT_OFFICER` (hand-written migration
  remaps every existing user row — `EMPLOYEE→MODERATOR`,
  `DEPARTMENT_HEAD→BOSS`, `WAREHOUSE_CLERK→STOREKEEPER`,
  `OFFICE_APPROVER`/`FACTORY_APPROVER`→`DIRECTOR`, nothing deleted).
  `ApprovalRoleAssignment` (the separate scope enum that resolves which
  specific `DIRECTOR` account handles the office route, factory route, or
  final approval) is untouched — it was already decoupled from `UserRole`.
  Admin's role `<select>` shows a live Mongolian permission summary per
  role and job `title` is now a real, free-text, admin-entered field.
- **Session/role freshness** — `lib/auth.ts`'s `jwt` callback re-reads
  `role`/`isActive` from the database on every request after sign-in (not
  just at login), so an admin changing someone's role or deactivating
  them takes effect on that user's very next API call and in their
  client-side session — no re-login, no waiting for the JWT to expire.
- **MANAGER price review** — a new, deliberately narrow capability
  (`PATCH /api/requests/[id]/items/[itemId]/price`): review and edit an
  item's unit price on an in-flight request, version-checked and
  audit-logged, with **no** approve/return/PIN authority — kept separate
  from `DIRECTOR`'s route/final approval and from `PROCUREMENT_OFFICER`'s
  purchasing, per explicit scoping.
- **Universal inventory submissions** (`lib/inventory.ts`,
  `InventorySubmission`) — any active user can submit a stock movement
  (material, warehouse, direction, quantity, reason, note) as a pending,
  auditable entry; it never touches the official `InventoryBalance`
  directly. `CLERK_WAREHOUSE_MANAGER`/`ADMIN` post (using the same
  compare-and-swap retry pattern as `warehouseCheck`, plus an explicit
  negative-balance guard) or reject it with a mandatory reason.
  `CLERK_INVENTORY`/`ADMIN` can also register brand-new `Material` catalog
  rows — previously nothing in the app could do this at all.

Verified over real HTTP: every seeded + new-role account logs in and gets
the right session role; an admin role change and a deactivation both take
effect on the affected user's very next request; MANAGER price edits
(success, 403 for non-managers, 409 on a stale version); inventory
submit→post, submit→reject, a rejected over-balance OUT posting, and
403s for non-reviewers; `CLERK_INVENTORY`-gated material registration;
and the full original request pipeline (create → BOSS approve →
STOREKEEPER warehouse-check with a real shortfall → `DIRECTOR`
route-approve → `DIRECTOR` final-approve) still completing end-to-end
under the renamed roles. Plus `lib/inventory.test.ts` (new) and expanded
`lib/workflow.test.ts` (`managerUpdateItemPrice`) in the vitest suite.

## Stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS** — industrial dark theme, tokens in `tailwind.config.ts`
- **Framer Motion** — timeline/allocation-bar animations · **Lucide** icons
- **Prisma** + **PostgreSQL** (`prisma/schema.prisma`) — migrated and seeded
- **NextAuth v4** (credentials provider, JWT sessions) — `lib/auth.ts`
- **Zod** for both form and API payload validation (`lib/validation.ts`)
- **Zustand** (`lib/store.ts`) — shared client state so an action on one
  screen is immediately visible on every other screen in the same session

### Why PostgreSQL, not SQLite

The spec requires `Decimal` for money and quantity (financial correctness).
Prisma's `Decimal` type is not supported on SQLite, only on
Postgres/MySQL/SQL Server/CockroachDB.

## Local development

```bash
npm install
cp .env.example .env
# generate a real NEXTAUTH_SECRET and paste it into .env:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
docker compose up -d            # starts local Postgres on :5433 (see note below)
npx prisma migrate dev          # creates tables from prisma/schema.prisma
npx prisma db seed              # seeds departments/users/materials/stock
npm run dev                     # picks an open port (3000 is often taken; check the log line)
```

**Why port 5433, not the default 5432:** on this dev machine, Docker
Desktop's port-forwarding mishandles connections to `5432` specifically —
Prisma gets a SCRAM authentication failure connecting from the Windows
host, even though the same credentials authenticate fine from inside the
Docker network. Publishing the container on `5433:5432` sidesteps it. If
you hit the same thing on a different machine, try containerizing the app
itself so DB traffic never leaves the Docker network.

### Demo accounts

All seeded users share the password `ubbuk2026` (also shown on the login
page itself, for local-dev convenience only):

| Email | Role | Job title |
|---|---|---|
| tumurbaatar@ubbuk.mn | MODERATOR | Ажилтан (Бетон цех) |
| bold@ubbuk.mn | BOSS | Цехийн дарга — Бетон цех |
| purev@ubbuk.mn | BOSS | Цехийн дарга — Металл хийцийн цех |
| erdene@ubbuk.mn | BOSS | Цехийн дарга — Механик засвар |
| munkhzul@ubbuk.mn | BOSS | Цехийн дарга — Санхүү, аж ахуй |
| ariunaa@ubbuk.mn | BOSS | Цехийн дарга — Удирдлага, захиргаа |
| sarnai@ubbuk.mn | STOREKEEPER | Нярав |
| khuntsengel@ubbuk.mn | DIRECTOR (route scope: OFFICE_APPROVER) | Оффисын чиглэлийн баталгаажуулагч |
| narmandakh@ubbuk.mn | DIRECTOR (route scope: FACTORY_APPROVER) | Үйлдвэрийн чиглэлийн баталгаажуулагч |
| magomed@ubbuk.mn | DIRECTOR (final scope) | Захирал |
| procurement@ubbuk.mn | PROCUREMENT_OFFICER | Худалдан авалтын ажилтан |
| admin@ubbuk.mn | ADMIN | Системийн админ |
| tuvshin@ubbuk.mn | MANAGER | Нийлүүлэлтийн менежер |
| tungalag@ubbuk.mn | WAREHOUSE | Агуулахын ажилтан |
| batjargal@ubbuk.mn | CLERK_INVENTORY | Бараа материалын бүртгэгч |
| oyunchimeg@ubbuk.mn | CLERK_WAREHOUSE_MANAGER | Агуулахын хяналтын мэргэжилтэн |

"Route scope" / "final scope" above refers to `ApprovalRoleAssignment` —
a separate table from `User.role` that decides which `DIRECTOR` account
handles the office route, the factory route, or the final approval;
`/admin`'s "Баталгаажуулах эрхийн хуваарилалт" card manages it.

## Project layout

```
app/
  login/                        credentials login page
  api/auth/[...nextauth]/       NextAuth route handler
  api/materials/                GET real catalog + stock, POST register (CLERK_INVENTORY/ADMIN)
  api/warehouses/                GET warehouse list
  api/departments/               GET real department list
  api/requests/                 GET list, POST create+submit
  api/requests/[id]/            GET single
  api/requests/[id]/department-approve/   POST — real, authorized, atomic
  api/requests/[id]/department-return/    POST — real, authorized, atomic
  api/requests/[id]/warehouse-check/      POST — stock allocation + reservation
  api/requests/[id]/route-approve/        POST — real, authorized, atomic
  api/requests/[id]/route-return/         POST — real, authorized, atomic
  api/requests/[id]/director-approve/     POST — real, authorized, atomic
  api/requests/[id]/director-return/      POST — real, authorized, atomic
  api/requests/[id]/resubmit/             POST — branches on return stage
  api/requests/[id]/items/[itemId]/price/ PATCH — MANAGER-only price review
  api/procurement/                        GET queue
  api/procurement/[id]/order/             POST — create PurchaseOrder
  api/procurement/goods-receipt/          POST — record GoodsReceipt
  api/inventory-submissions/              GET list, POST submit (any active user)
  api/inventory-submissions/[id]/post/    POST — CLERK_WAREHOUSE_MANAGER/ADMIN
  api/inventory-submissions/[id]/reject/  POST — CLERK_WAREHOUSE_MANAGER/ADMIN
  api/me/pin/                             GET hasPin, POST setup/change
  api/notifications/                      GET list, [id]/read, read-all
  api/events/                             GET — SSE stream
  api/admin/users/                        GET list, POST create
  api/admin/users/[id]/                   PATCH role/title/department/active
  api/admin/users/[id]/reset-credentials/ POST — temp password, shown once
  api/admin/users/[id]/reset-pin/         POST — force-clears the PIN
  api/admin/departments/[id]/             PATCH headId
  api/admin/approval-roles/               GET/POST singleton role holders
  (app)/                        route group behind middleware auth
    dashboard/, requests/, approvals/, warehouse/, inventory/,
    procurement/, archive/, reports/, settings/, admin/
middleware.ts                   redirects unauthenticated requests to /login
lib/
  auth.ts                       NextAuth config (credentials, JWT callbacks —
                                 jwt callback re-reads role/isActive from the
                                 DB on every request after sign-in)
  prisma.ts                     PrismaClient singleton
  serialize.ts                  Prisma rows -> MaterialRequestView (UI shape)
  workflow.ts                   all approval/return/warehouse-check/
                                 procurement/resubmission/price-review logic
  inventory.ts                  universal inventory submission/post/reject/
                                 material-registration logic
  pin.ts                        PIN verify/lockout (lib/pin.ts)
  events.ts                     SSE event bus
  admin-auth.ts                 requireAdmin(session) guard
  credentials.ts                generateTempPassword()
  workflow.test.ts              vitest suite against the real dev database
  inventory.test.ts             vitest suite for inventory submissions
  store.ts                      Zustand — every action writes through to
                                 the real database
  types.ts                      shared view types + USER_ROLES/
                                 USER_ROLE_LABEL/ROLE_PERMISSION_SUMMARY/
                                 APPROVER_ROLES (single source of truth)
  validation.ts                 Zod schemas (form + API)
prisma/schema.prisma             full data model
prisma/seed.ts                   departments, users, approver roles,
                                  material catalog, initial stock
```

## Design tokens

Dark industrial theme — see `tailwind.config.ts`:
background `#0B1118`, sidebar `#111C26`, surface `#17242F`, elevated
`#1E303D`, border `#304451`, accent `#F59E0B`, success `#22C55E`, warning
`#F97316`, danger `#EF4444`. Inter font (Cyrillic subset loaded).

## Known limitations (do not treat as done)

- **PDF export, QR verification, attachment upload** not implemented.
- **Single-warehouse assumption** in `warehouseCheck`'s stock allocation
  (see the comment in `lib/workflow.ts`) — correct for all current data
  (one seeded `Warehouse`) but would need a real multi-warehouse
  allocation pass if a second warehouse is ever added.
- **Real-time is single-process** — `lib/events.ts`'s event bus is an
  in-memory `EventEmitter`; it fans out correctly within one Node process
  but wouldn't fan out across multiple server instances behind a load
  balancer. The polling fallback still guarantees eventual consistency
  either way, but a multi-instance deployment would want a real pub/sub
  (Redis, Postgres `LISTEN`/`NOTIFY`, etc.) behind the same `emitBroadcast`/
  `emitUserEvent` interface.
- **No resubmission edit UI for adding brand-new items** after a route/
  director return — only the already-open shortfall's quantity can be
  adjusted or cancelled, by design (the available portion already moved
  real stock and can't be rewritten). A genuinely new line item at that
  point would need to go back through warehouse check from scratch, which
  isn't modeled as a resubmission path.
- **Test coverage covers the highest-value properties, not the full spec
  matrix** — `lib/workflow.test.ts` covers authorization, the
  double-approval race guard, PIN correct/wrong/lockout, stale-version
  rejection, warehouse-check allocation math, and both resubmission paths.
  A scripted login-for-every-role pass and the rest of the spec's manual
  test list are still manual/ad hoc.
- **Middleware's page gate doesn't re-check the DB on every request** —
  `middleware.ts` uses NextAuth's edge-compatible `withAuth`, which
  decodes the signed JWT cookie directly and never runs `lib/auth.ts`'s
  custom `jwt` callback (edge middleware can't safely call Prisma). The
  callback *does* run on every `getServerSession`/`/api/auth/session`
  call, so the actual authorization layer — every API route, and the
  client's own `useSession()` (what Sidebar/Settings/the request page use
  to decide what to render) — reflects a role change or deactivation
  immediately. The one gap: a deactivated/demoted user's browser could
  still load an app page's empty shell for a moment before its data
  fetches 401/403. No privileged action or data is exposed either way.
- **MANAGER's scope is a new, narrow capability** — price review only, no
  assignment mechanism (any active MANAGER account can edit any
  non-terminal request's prices, not just ones "assigned" to them, since
  no per-request manager-assignment concept was requested).

## Next steps

1. PDF export (Маягт №1 layout) + QR verification page.
2. Attachment upload (the UI already has a file picker; nothing persists
   it yet).
3. A real pub/sub backend for `lib/events.ts` if this ever needs to run
   as more than one server process.
4. Expand `lib/workflow.test.ts` toward the spec's full manual test list.
5. If multi-instance deployment or a non-Node middleware runtime is ever
   needed, revisit the middleware page-gate limitation above.
