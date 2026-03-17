function normalizeAllowedOrigin(value) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const candidate = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
    return new URL(candidate).host;
  } catch {
    return null;
  }
}

const allowedOrigins = Array.from(
  new Set(
    [
      "localhost:3000",
      "127.0.0.1:3000",
      normalizeAllowedOrigin(process.env.APP_BASE_URL),
      normalizeAllowedOrigin(process.env.APP_URL),
      normalizeAllowedOrigin(process.env.NEXT_PUBLIC_APP_URL),
      normalizeAllowedOrigin(process.env.NEXTAUTH_URL),
      process.env.VERCEL_URL || null,
    ].filter(Boolean)
  )
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "*.r2.cloudflarestorage.com",
      },
    ],
  },
  experimental: {
    serverActions: {
      allowedOrigins,
    },
  },
  webpack: (config) => {
    // Windows + Node 22 can throw EISDIR on fs.readlink during filesystem cache snapshots.
    // Disable webpack persistent cache to avoid readlink-based snapshotting.
    config.cache = false;
    return config;
  },
};

export default nextConfig;
