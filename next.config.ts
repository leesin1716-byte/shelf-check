import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: { unoptimized: true },
  // Agent cache files are read at runtime by the API route; make sure they ship with the function.
  outputFileTracingIncludes: { "/api/agent": ["./data/agent-cache/**/*"] },
};

export default nextConfig;
