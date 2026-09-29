import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The extension zip route reads the unpacked extension from disk at request time.
  outputFileTracingIncludes: { "/api/extension/download": ["./extension/**/*"] },
};

export default nextConfig;
