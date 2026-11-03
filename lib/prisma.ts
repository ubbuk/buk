import { PrismaClient } from "@prisma/client";

// Reuse a single PrismaClient across Next.js dev-mode hot reloads instead of
// opening a new connection pool on every edit.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Default interactive-transaction limits are 2 s to start / 5 s to finish. With the app on
    // a serverless host and PostgreSQL in another region (e.g. Vercel + Aiven) every query costs
    // 100-250 ms, so a multi-step workflow transaction can exceed 5 s and fail with a 500.
    transactionOptions: { maxWait: 10_000, timeout: 30_000 },
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
