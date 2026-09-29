import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The extension zip route reads the unpacked extension from disk at request time.
  outputFileTracingIncludes: { "/api/extension/download": ["./extension/**/*"] },
  // Brand fonts in /public are not content-hashed: browsers keep them for a year instead of revalidating on every visit
  // (a round trip each from Kazakhstan). If a font file is ever replaced, give it a new file name.
  async headers() {
    return [{ source: "/fonts/:file*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] }];
  },
};

export default nextConfig;
