import bcrypt from "bcrypt";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "./prisma";
import { cached } from "./cache";
import { clientIp } from "./client-ip";
import { admit, loginBuckets } from "./login-throttle";

// A valid bcrypt hash (cost 10, like real ones) nobody knows the password of, used to spend the same
// time on accounts that do not exist or are disabled. Built once per process.
let dummy: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  return (dummy ??= bcrypt.hash(`dummy-${Math.random()}-${Date.now()}`, 10));
}

// Safety-net TTL for the jwt callback's re-validation query below. The admin
// PATCH route (app/api/admin/users/[id]/route.ts) explicitly invalidates a
// user's entry the moment their role/isActive changes, so that path still
// takes effect immediately — this TTL only bounds staleness for the (rare,
// documented) case of a role edit made outside that route, e.g. directly in
// the database.
const SESSION_CACHE_TTL_MS = 5000;

export function userSessionCacheKey(userId: string) {
  return `user-session:${userId}`;
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "И-мэйл", type: "email" },
        password: { label: "Нууц үг", type: "password" },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials.password) return null;

        // Rate limit BEFORE any user lookup or bcrypt work (lib/login-throttle.ts). A refused attempt is
        // the same for an e-mail that exists and one that does not, so it reveals nothing about accounts.
        // If the limiter itself fails, the check is refused (fail closed) with a generic error.
        let admission;
        try {
          admission = await admit(loginBuckets(credentials.email, clientIp(req?.headers)));
        } catch {
          throw new Error("THROTTLE_UNAVAILABLE");
        }
        if (!admission.ok) {
          console.warn("[auth] authorize: reason=rate_limited scope=" + admission.blockedBy);
          throw new Error("RATE_LIMITED");
        }

        // Admin-created emails are stored exactly as typed, so match case-insensitively
        // and ignore stray whitespace from copy/paste.
        // Failure reasons are logged as codes only — never the email or password.
        let user;
        try {
          user = await prisma.user.findFirst({
            where: { email: { equals: credentials.email.normalize("NFKC").trim(), mode: "insensitive" } },
          });
        } catch (err) {
          console.error("[auth] authorize: user lookup failed", err instanceof Error ? err.name : "unknown");
          throw err; // surfaces as a non-CredentialsSignin error, not "wrong password"
        }
        if (!user || !user.isActive) {
          // Same amount of bcrypt work as a real check, so response time does not tell an unknown
          // or disabled account from a wrong password.
          await bcrypt.compare(credentials.password, await dummyHash());
          console.warn(`[auth] authorize: reason=${user ? "inactive" : "no_user"}`);
          return null;
        }

        const valid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!valid) {
          console.warn("[auth] authorize: reason=bad_password");
          return null;
        }
        await admission.settle();

        await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          departmentId: user.departmentId,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.departmentId = user.departmentId;
        return token;
      }
      // Re-read role/isActive fresh from the DB (through a short-TTL cache,
      // actively invalidated on role/isActive edits — see above) on every
      // request after sign-in, so an admin changing a user's role or
      // deactivating them takes effect on that user's very next request
      // instead of waiting for the JWT (default 30-day maxAge) to expire —
      // without this every authenticated request on the app hitting the DB
      // a second time just to re-check a role that almost never changes.
      if (token.id) {
        const fresh = await cached(userSessionCacheKey(token.id as string), SESSION_CACHE_TTL_MS, () =>
          prisma.user.findUnique({ where: { id: token.id as string }, select: { role: true, departmentId: true, isActive: true } })
        );
        if (!fresh || !fresh.isActive) {
          token.role = "";
        } else {
          token.role = fresh.role;
          token.departmentId = fresh.departmentId;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
        session.user.departmentId = (token.departmentId as string | null) ?? null;
      }
      return session;
    },
  },
};
