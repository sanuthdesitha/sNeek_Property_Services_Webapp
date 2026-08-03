import withPWAInit from "@ducanh2912/next-pwa";

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
    serverComponentsExternalPackages: ["@prisma/client", "prisma", "pino"],
    outputFileTracingExcludes: {
      "*": ["./sneek-nextgen/**/*"],
    },
  },
  webpack: (config) => {
    // Windows + Node 22 can throw EISDIR on fs.readlink during filesystem cache snapshots.
    // Disable webpack persistent cache to avoid readlink-based snapshotting.
    config.cache = false;
    return config;
  },
};

const withPWA = withPWAInit({
  dest: "public",
  // Custom worker for Web Push handlers — next-pwa compiles worker/index.ts and
  // injects it into the generated public/sw.js via importScripts at build time.
  customWorkerSrc: "worker",
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  // NEVER reload the page when connectivity returns.
  //
  // This option injects `addEventListener("online", () => location.reload())`.
  // A cleaner uploading a photo is performing the longest, heaviest network
  // operation in the app, and a momentary blip — Wi-Fi roaming, mobile
  // handover, a saturated uplink — fires `online` and hard-reloads the page
  // mid-request. The browser aborts the POST, and the server records it as
  // `Error: aborted … ECONNRESET` from abortIncoming: a body that started
  // arriving and then stopped.
  //
  // That is what "I pick a photo, press OK, the page refreshes and nothing
  // uploads" was. It looked account-specific because it tracks the person's
  // NETWORK rather than their identity, and it never reproduced locally
  // because the service worker is disabled in development (`disable` below).
  //
  // Reloading on reconnect is hostile here regardless of uploads: these
  // portals are full of long forms, and discarding the page throws away work
  // nobody asked us to throw away. Refreshing data after a genuine absence is
  // handled deliberately in components/shared/return-sync.tsx instead.
  reloadOnOnline: false,
  disable: process.env.NODE_ENV === "development",
  extendDefaultRuntimeCaching: true,
  workboxOptions: {
    disableDevLogs: true,
    runtimeCaching: [
      {
        urlPattern: /^\/api\/cleaner\/jobs/i,
        handler: "NetworkFirst",
        method: "GET",
        options: {
          cacheName: "cleaner-jobs-cache",
          expiration: {
            maxEntries: 32,
            maxAgeSeconds: 60 * 60,
          },
          networkTimeoutSeconds: 5,
        },
      },
    ],
  },
});

export default withPWA(nextConfig);
