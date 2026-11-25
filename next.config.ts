import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  output: "standalone",
  images: { unoptimized: true },
  // Native Sharp libraries (including Windows DLLs) are loaded dynamically.
  // Keep them with pnpm's platform package in the standalone deployment.
  outputFileTracingIncludes: {
    "/*": ["node_modules/.pnpm/@img+sharp-*/node_modules/@img/sharp-*/lib/**/*"],
  },
  // libheif's WebAssembly build decodes HEIC uploads (TRA-179). Node loads it as published, rather than from a bundle.
  serverExternalPackages: ["libheif-js"],
  experimental: { serverActions: { bodySizeLimit: "16mb" } },
};
export default nextConfig;
