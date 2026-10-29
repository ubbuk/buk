import { PrismaClient } from "@prisma/client";

// Reuse a single PrismaClient across Next.js dev-mode hot reloads instead of
// opening a new connection pool on every edit.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
