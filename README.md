# УБ БҮК ХК — Худалдан авалтын систем (Industrial Procurement ERP)

Digitizes Улаанбаатар БҮК ХК's paper-based material requisition process
(Маягт №1): request → department head approval → warehouse verification
(partial allocation) → OFFICE/FACTORY route approval → director approval →
procurement → fulfillment.

## Status

Greenfield build (the working directory was empty when this started).

**Real, database-backed and tested end-to-end:**
- Authentication (NextAuth, credentials provider, bcrypt-hashed passwords,
  seeded users with real roles) — see `prisma/seed.ts` for accounts.
- Middleware gating every app route behind login (`middleware.ts`).
- Material request creation (`POST /api/requests`) — resolves against the
  real `Material` catalog, snapshots the live stock balance, resolves the
  department head / warehouse clerk / route approver / director from the
  database (never hardcoded names), issues a real sequential request
  number, writes an audit log entry and a notification.
- Department-head approval/return (`POST .../department-approve`,
  `.../department-return`) — authorization checked against
  `Department.headId` (the real user id, not a name match), an atomic
  conditional update prevents double-approval (verified: concurrent/repeat
  approval attempts correctly get `409`; wrong user gets `403`), writes
  `ApprovalAction` + `AuditLog` + `Notification` rows.

All of this was exercised over real HTTP against the running app (login,
submit, wrong-user rejection, correct approval, double-approval rejection,
return-with-reason) — not just typechecked. See the chat history for the
verification transcript.

**Still client-side simulation only** (next increment): warehouse stock
verification/reservation, OFFICE/FACTORY route approval, director approval,
the resulting purchasing queue, PDF export, QR verification, real-time
notifications UI, automated test suite.

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

| Email | Role |
|---|---|
| tumurbaatar@ubbuk.mn | Ажилтан (requester, Бетон цех) |
| bold@ubbuk.mn | Цехийн дарга — Бетон цех |
| purev@ubbuk.mn | Цехийн дарга — Металл хийцийн цех |
| erdene@ubbuk.mn | Цехийн дарга — Механик засвар |
| munkhzul@ubbuk.mn | Цехийн дарга — Санхүү, аж ахуй |
| ariunaa@ubbuk.mn | Цехийн дарга — Удирдлага, захиргаа |
| sarnai@ubbuk.mn | Нярав |
| narmandakh@ubbuk.mn | Үйлдвэрийн чиглэлийн баталгаажуулагч |
| khuntsengel@ubbuk.mn | Оффисын чиглэлийн баталгаажуулагч |
| magomed@ubbuk.mn | Захирал |
| procurement@ubbuk.mn | Худалдан авалтын ажилтан |

## Project layout

```
app/
  login/                        credentials login page
  api/auth/[...nextauth]/       NextAuth route handler
  api/materials/                GET real catalog + stock
  api/requests/                 GET list, POST create+submit
  api/requests/[id]/            GET single
  api/requests/[id]/department-approve/   POST — real, authorized, atomic
  api/requests/[id]/department-return/    POST — real, authorized, atomic
  (app)/                        route group behind middleware auth
    dashboard/, requests/, approvals/, warehouse/, procurement/,
    archive/, reports/, settings/
middleware.ts                   redirects unauthenticated requests to /login
lib/
  auth.ts                       NextAuth config (credentials, JWT callbacks)
  prisma.ts                     PrismaClient singleton
  serialize.ts                  Prisma rows -> MaterialRequestView (UI shape)
  workflow.ts                   department-approve/return business logic
  store.ts                      Zustand — real for create/dept-approve/
                                 return, client-only simulation beyond that
  validation.ts                 Zod schemas (form + API)
  mock-data.ts, mock-session.ts department list, illustrative-only data
                                 for screens not yet wired to the API
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

- **Warehouse check, route approval, director approval** still run as
  client-only simulation (`lib/store.ts`'s `approveStep`/`returnStep`/
  `submitWarehouseCheck`) — not yet backed by API routes or real stock
  reservation. This is the next increment.
- **No stock reservation/locking** — `InventoryBalance.quantityReserved`
  exists in the schema but nothing writes to it yet.
- **PDF export, QR verification, attachments upload** not implemented.
- **Notifications are written to the database but there's no UI** reading
  them yet (the bell icon in the topbar is still decorative).
- **No automated test suite** — verification so far has been real HTTP
  requests against the running dev server plus `tsc`/`eslint`/`next build`.

## Next steps

1. Warehouse verification API: transactional stock check using
   `SELECT ... FOR UPDATE` (or an atomic conditional update on
   `InventoryBalance`) so concurrent requests can't over-allocate the same
   stock, writing `WarehouseCheck`/`WarehouseCheckItem`/`StockReservation`.
2. Route (Б.Нармандах/Н.Хүнцэнгэл) and director (Хамхоев Магомед) approval
   API routes, same atomic-approve pattern as department-head.
3. Purchasing queue backed by `PurchaseRequirement`/`PurchaseOrder`.
4. PDF export (Маягт №1 layout) + QR verification page.
5. Notifications UI (topbar bell) reading the `Notification` table.
