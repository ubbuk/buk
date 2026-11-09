-- Login / password-change rate limiting (lib/login-throttle.ts).
--
-- Additive only: one new table. No existing table, column, row, constraint or index is touched,
-- so it is safe on a database that already holds data. The application needs this table to
-- verify credentials (it fails closed without it): run this migration BEFORE deploying the code.

-- CreateTable
CREATE TABLE "LoginThrottle" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoginThrottle_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "LoginThrottle_windowStart_idx" ON "LoginThrottle"("windowStart");
