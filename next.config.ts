import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Disable ESLint during builds/dev so generated runtime files don't fail the dev server.
  // We still keep eslint configs in the repo; this prevents Next from aborting dev on
  // large generated bundles (we ignore them via .eslintignore as well).
  turbopack: {
    // Ensure turbopack uses this project folder as the root when running in multi-lockfile environments
    // This removes the "inferred workspace root" warning during dev.
    root: __dirname,
  },
};

export default nextConfig;
