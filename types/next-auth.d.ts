import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
      departmentId: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    role: string;
    departmentId: string | null;
    sessionVersion?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: string;
    departmentId: string | null;
    /** credential generation the session was issued under; absent on tokens from before Stage 2 (= 0) */
    sv?: number;
  }
}
