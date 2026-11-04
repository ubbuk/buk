# Time Machine, historical snapshots and the Backup Vault

## What it is, and what it is not

* **Historical reconstruction**: the state of every material request at a chosen moment, rebuilt from the `AuditLog` by the C++20 history engine (`native/history-engine`). Read-only.
* **Historical snapshot**: an immutable, checksummed JSON artifact of one reconstruction plus the raw engine inputs, stored in object storage under `snapshots/`.
* **It is not a PostgreSQL backup.** It contains request statuses and timings, not rows, items, prices, stock or users, and it cannot restore the database. Every snapshot manifest carries `notADatabaseBackup: true` and the UI repeats it.

## API (ADMIN or DIRECTOR; checked on the server for every call)

| Endpoint | Purpose |
|---|---|
| `GET /api/admin/time-machine/reconstruct?asOf=<ISO>` | reconstruct at `asOf`; nothing is stored; request list trimmed to 500 rows, totals and completeness cover all |
| `GET /api/admin/time-machine/snapshots` | snapshots (newest first), latest verify / test-restore result, storage driver, location, object count and bytes |
| `POST /api/admin/time-machine/snapshots` `{asOf}` | create an immutable snapshot |
| `POST /api/admin/time-machine/snapshots/<id>/verify` | re-hash the artifact: size, SHA-256, identifier, structure |
| `POST /api/admin/time-machine/snapshots/<id>/test-restore` | verify, then replay the stored inputs with the C++ engine **and** the independent TypeScript reference; both must reproduce the stored result |

401 without a session, 403 for any other role (recorded like other monitoring denials). `asOf` must be an ISO timestamp, not in the future. Snapshot ids are validated against the generated format.

**"Test restore" does not touch any database.** It runs in memory. A full PostgreSQL restore is a separate capability that has not been approved or built.

## Storage layout (no database schema change)

```
snapshots/<id>.json                            artifact (canonical JSON, sorted keys)
snapshots/<id>.manifest.json                   asOf, createdAt, createdBy, completeness, size, SHA-256, engine + version, storage driver
snapshots/reports/<id>/verify-<ts>-<r>.json    verification results
snapshots/reports/<id>/restore-test-<ts>-<r>.json
```

`<id>` = `<createdAt>_<asOf>_<first 12 hex of the SHA-256>_<random>`. Objects are written only with `putNew` (local `wx` flag; S3 `If-None-Match: *`), never overwritten, and nothing in the application deletes them. A swapped artifact is detected even if its manifest is rewritten, because the id embeds the artifact hash.

`ObjectStorage` gained `list(prefix)` and `putNew(key, data)` (local and S3 drivers). Under S3 the configured `S3_PREFIX` (default `attachments/`) is prepended, so objects live at `attachments/snapshots/…`.

## Deployment requirements

1. **Durable storage.** `STORAGE_DRIVER=s3` (+ `S3_*`) on Vercel; the local disk is wiped there. The Vault shows "Not durable" when the local driver runs on a serverless host.
2. **Minimum S3 permissions for snapshots** (add to the existing attachments policy; nothing is changed automatically):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "SnapshotsReadWrite", "Effect": "Allow", "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::BUCKET/attachments/snapshots/*" },
    { "Sid": "SnapshotsList", "Effect": "Allow", "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::BUCKET",
      "Condition": { "StringLike": { "s3:prefix": ["attachments/snapshots/*"] } } }
  ]
}
```

   No `s3:DeleteObject` is needed for snapshots. Recommended hardening (not done): bucket versioning and Object Lock / an explicit `Deny` on `s3:DeleteObject` for `attachments/snapshots/*`. Conditional writes (`If-None-Match`) work on AWS S3 and Cloudflare R2; some other S3-compatible servers ignore them, which weakens the no-overwrite guarantee (keys still contain a random part).
3. **Migrations:** none. No Prisma migration is part of this work; pushing it does not require touching the production database.
4. **WASM:** the engine is embedded in the bundle (`history-engine.wasm.generated.ts`); the only deployment step is committing that file.
5. Vercel function limits: reconstruction reads all requests created before `asOf` and their transition events (capped at 20,000 requests / 200,000 events; beyond that the result is marked incomplete).

## Known limitations

* The audit log stores no status after an event, so statuses come from replaying the workflow. The warehouse outcome is inferred from facts that cannot change later (live status, `completedAt`, later decisions) and is flagged `AMBIGUOUS` when not decidable.
* Changes made outside the application (direct SQL) or before auditing existed cannot be seen.
* The Time Machine window is the last 30 days from page load; older moments can be reconstructed through the API.
* `CANCEL` and `REJECT` appear in the audit enum, but the current workflow only writes `RETURN`. `REJECT` is flagged as unexplained rather than interpreted.
* Item quantities, prices, attachments and stock are not reconstructed.

## Real PostgreSQL backup: audit and design (not implemented)

**Audit (local development stack, `hangamj2-db-1`):** PostgreSQL 16.15, `wal_level=replica`, `archive_mode=off`, `archive_command` disabled, one Docker named volume on the host disk, no backup scripts, no cron, no retention policy in the repository. **Point-in-time recovery is not available** there.

**Production (Aiven):** not inspected from this environment. Aiven's managed PostgreSQL provides automated backups and, depending on plan, PITR; the retention window and PITR availability must be confirmed in the Aiven console before relying on it.

**Proposed design (needs separate approval; changes backup infrastructure):**

1. Production: rely on Aiven's managed backups/PITR, confirm retention and run a restore drill into a new, empty service. Add a scheduled logical dump (`pg_dump -Fc`) to a *separate* bucket with a SHA-256 manifest as a second line of defence.
2. Self-hosted Docker: enable `archive_mode=on` with `archive_command` to object storage through WAL-G or pgBackRest, nightly base backups, retention and `verify`/`pg_verifybackup` checks, monitor archive lag and bucket capacity.
3. Restores always target a **new empty instance**; never over production, never `DROP`/`TRUNCATE`, with the instance identity (container id, volume, `current_database()`, host) verified first, as was done for the test database in this work.

Until one of these exists, nothing in the application may be described as a database backup, and snapshots must not be treated as one.
