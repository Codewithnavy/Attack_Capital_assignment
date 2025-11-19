import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  turbopack: {
    // Ensure turbopack uses this project folder as the root when running in multi-lockfile environments
    // This removes the "inferred workspace root" warning during dev.
    root: __dirname,
  },
};

export default nextConfig;
