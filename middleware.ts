import { withAuth } from "next-auth/middleware";

export default withAuth({
  pages: {
    signIn: "/login",
  },
  callbacks: {
    // The jwt callback re-validates role/isActive against the DB on every
    // request and clears role to "" if the user was deactivated or no
    // longer exists — treat that the same as "not authenticated" so a
    // revoked session is kicked to /login on its very next request
    // instead of waiting for the JWT to expire.
    authorized: ({ token }) => !!token && !!token.role,
  },
});

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/requests/:path*",
    "/approvals/:path*",
    "/warehouse/:path*",
    "/warehouses/:path*",
    "/accounting/:path*",
    "/procurement/:path*",
    "/archive/:path*",
    "/reports/:path*",
    "/settings/:path*",
    "/profile/:path*",
    "/admin/:path*",
  ],
};
