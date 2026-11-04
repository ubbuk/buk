import bcrypt from "bcrypt";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "./prisma";
import { cached } from "./cache";

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
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null;

        // Admin-created emails are stored exactly as typed, so match case-insensitively
        // and ignore stray whitespace from copy/paste.
        const user = await prisma.user.findFirst({
          where: { email: { equals: credentials.email.trim(), mode: "insensitive" } },
        });
        if (!user || !user.isActive) return null;

        const valid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!valid) return null;

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
