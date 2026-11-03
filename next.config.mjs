import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ONE_YEAR = 60 * 60 * 24 * 365;
const ONE_WEEK = 60 * 60 * 24 * 7;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: __dirname,
  async headers() {
    return [
      // Static assets keep their name when edited: cache for a week and serve
      // stale while revalidating in the background.
      {
        source: "/images/:path*",
        headers: [{ key: "Cache-Control", value: `public, max-age=${ONE_WEEK}, stale-while-revalidate=86400` }],
      },
      {
        source: "/models/:path*",
        headers: [{ key: "Cache-Control", value: `public, max-age=${ONE_WEEK}, stale-while-revalidate=86400` }],
      },
      // Content-hashed model files (forklift.<hash>.glb) never change under the
      // same URL, so the browser can keep them without revalidating. Listed after
      // the generic rule above because later matching headers win.
      {
        source: "/models/:file(.+\\.[0-9a-f]{8}\\.glb)",
        headers: [{ key: "Cache-Control", value: `public, max-age=${ONE_YEAR}, immutable` }],
      },
    ];
  },
};

export default nextConfig;
