import { NextResponse } from "next/server";
import { withAuth } from "next-auth/middleware";
import { pageAllowed } from "@/lib/route-access";

// First line for DIRECT visits (typed or bookmarked URLs): the cookie must hold a session with a role, and the role must be
// allowed for the page. Middleware runs on the edge and only decodes the cookie: it cannot see a revocation or a role change
// made in the last session lifetime. The (app) layout re-validates the session against the database on every full page load,
// and every API route checks the role again, so this is defence in depth, not the only check (lib/route-access.ts).
export default withAuth(
  function middleware(req) {
    if (!pageAllowed(req.nextauth.token?.role as string | undefined, req.nextUrl.pathname)) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
    return NextResponse.next();
  },
  {
    pages: {
      signIn: "/login",
    },
    callbacks: {
      // A token without a role is a revoked / deactivated one: treat it as not signed in.
      authorized: ({ token }) => !!token && !!token.role,
    },
  }
);

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/requests/:path*",
    "/approvals/:path*",
    "/warehouse/:path*",
    "/warehouses/:path*",
    "/accounting/:path*",
    "/procurement/:path*",
    "/foreign-trade/:path*",
    "/finance/:path*",
    "/onec/:path*",
    "/archive/:path*",
    "/reports/:path*",
    "/settings/:path*",
    "/profile/:path*",
    "/admin/:path*",
  ],
};
