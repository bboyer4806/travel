import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  output: "standalone",
  images: { unoptimized: true },
  // Native Sharp libraries (including Windows DLLs) are loaded dynamically.
  // Keep them with pnpm's platform package in the standalone deployment.
  outputFileTracingIncludes: {
    "/*": ["node_modules/.pnpm/@img+sharp-*/node_modules/@img/sharp-*/lib/**/*"],
  },
  experimental: { serverActions: { bodySizeLimit: "16mb" } },
};
export default nextConfig;
