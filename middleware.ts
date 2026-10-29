import { withAuth } from "next-auth/middleware";

export default withAuth({
  pages: {
    signIn: "/login",
  },
});

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/requests/:path*",
    "/approvals/:path*",
    "/warehouse/:path*",
    "/procurement/:path*",
    "/archive/:path*",
    "/reports/:path*",
    "/settings/:path*",
  ],
};
