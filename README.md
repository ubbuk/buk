# УБ БҮК ХК — Худалдан авалтын систем (Industrial Procurement ERP)

Digitizes Улаанбаатар БҮК ХК's paper-based material requisition process
(Маягт №1): request → department head approval → warehouse verification
(partial allocation) → OFFICE/FACTORY route approval → director approval →
procurement → fulfillment.

## Status

This is a **greenfield build** — the working directory was empty when this
project started, so there was no existing codebase to extend. Built in
phases; currently complete:

- **Phase 1** — repository inspection (nothing to inspect; documented here).
- **Phase 2** — design system, app shell (sidebar/topbar), dashboard, the
  Маягт №1 request form, request list/detail, a warehouse-check screen, an
  approvals queue, a procurement queue, an archive view, a reports view, and
  a settings screen for configuring approver role assignments. **All of
  these currently run on demo data** (`lib/mock-data.ts`, `lib/mock-session.ts`)
  — every screen that reads it shows a "Жишээ өгөгдөл" (demo data) badge.
  There is no database or API wired up yet.

Not yet built (Phases 3–7 from the original spec): Prisma migrations run
against a live database, API routes, NextAuth-based authentication,
server-side stock reservation with locking, the OFFICE/FACTORY → director
approval state machine enforced server-side, PDF export with QR
verification, notifications, and automated tests.

## Stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS** — industrial dark theme, tokens in `tailwind.config.ts`
- **Framer Motion** — timeline/allocation-bar animations
- **Lucide** — icons
- **Prisma** targeting **PostgreSQL** (schema in `prisma/schema.prisma`,
  not yet migrated — see below)
- **Zod** for validation (`lib/validation.ts`)
- **NextAuth** and **@react-pdf/renderer** are in `package.json` for Phase 3+
  but not wired up yet

### Why PostgreSQL, not SQLite

The spec requires `Decimal` for money and quantity (financial correctness).
Prisma's `Decimal` type is not supported on SQLite, only on
Postgres/MySQL/SQL Server/CockroachDB. Postgres was chosen as the
production-appropriate default. A `docker-compose.yml` is included for a
local instance.

## Local development

```bash
npm install
cp .env.example .env        # fill in DATABASE_URL / NEXTAUTH_SECRET
npm run dev                 # http://localhost:3000
```

The app runs today **without a database** — every page currently reads from
`lib/mock-data.ts`. You only need Postgres once Phase 3 (API + Prisma
client wiring) lands:

```bash
docker compose up -d        # starts local Postgres on :5433 (see note below)
npm run prisma:migrate      # creates tables from prisma/schema.prisma
```

The initial migration has been applied and verified against a real local
Postgres container (`prisma/migrations/20261029085322_init`).

**Why port 5433, not the default 5432:** on this machine, Docker Desktop's
port-forwarding mishandles connections to `5432` specifically — Prisma
(and presumably any client) gets a SCRAM authentication failure connecting
from the Windows host, even though the exact same credentials authenticate
fine for a connection made from inside the Docker network. Publishing the
container on `5433:5432` instead sidesteps it entirely. If you hit the
same thing on a different port, try containerizing the app itself so DB
traffic stays inside the Docker network rather than going through the
host port-forward.

## Project layout

```
app/(app)/            route group sharing the sidebar+topbar shell
  dashboard/           Хяналтын самбар
  requests/new/         Шинэ захиалга — Маягт №1 form
  requests/[id]/           request detail + approval timeline
  approvals/            Батлах хүсэлтүүд queue
  warehouse/[id]/          interactive stock-allocation check
  procurement/           purchasing work queue
  archive/               completed/cancelled requests
  reports/                department spend / status breakdown
  settings/               approver role assignment
components/
  layout/               Sidebar, Topbar
  ui/                    Button, Card, DataTable, Modal, Toast, StatusBadge, ...
  workflow/               ApprovalTimeline, AllocationBar
  requests/                MaterialRequestForm, MaterialCombobox
lib/
  mock-data.ts, mock-session.ts   DEMO data — delete once API lands
  types.ts                        status/enum labels shared by UI + (future) API
  validation.ts                    Zod schemas for the request form
prisma/schema.prisma               full data model (Phase 3)
```

## Design tokens

Dark industrial theme — see `tailwind.config.ts`:
background `#0B1118`, sidebar `#111C26`, surface `#17242F`, elevated
`#1E303D`, border `#304451`, accent `#F59E0B`, success `#22C55E`, warning
`#F97316`, danger `#EF4444`. Inter font (Cyrillic subset loaded).

## Known limitations (do not treat as done)

- **No auth.** The "current user" is hardcoded in `lib/mock-session.ts`.
  Role-based nav visibility and API authorization are not implemented yet.
- **No persistence.** "Save draft" writes to `localStorage` only; "Submit"
  simulates a request number client-side. Nothing reaches a server.
- **Approve/Return buttons** on the request detail and warehouse-check
  screens update local component state and show a toast — they do not call
  an API or move the request through the real workflow yet.
- **PDF export, QR verification, notifications, attachments upload** are
  not implemented — attachments are held as in-memory `File` objects only.
- **No automated tests yet.**

## Next steps (Phase 3)

1. Stand up Postgres (`docker compose up -d`), run `prisma migrate dev`,
   seed departments/users/materials.
2. Add NextAuth (credentials provider against `User.passwordHash`), replace
   `lib/mock-session.ts` with the real session.
3. Build the API routes listed in the spec (create/submit/approve/reject
   request, warehouse check with transactional stock reservation, route +
   director approval, purchasing queue, goods receipt, notifications, audit
   log) and swap every `lib/mock-data.ts` read for a real fetch.
