import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: __dirname,
  serverExternalPackages: ["pg", "@prisma/adapter-pg"],
};

export default nextConfig;
