// Preflight check — runs before `npm start`.
// Prevents prisma migrate deploy from being silently included in startup
// (the May 2026 multi-replica migration thrash that pinned CPU at 100%).

const PRISMA_MIGRATE_GUARD = process.env.SNEEK_ALLOW_STARTUP_MIGRATE === "true";
const SKIP_PREFLIGHT = process.env.SNEEK_SKIP_PREFLIGHT === "true";

if (SKIP_PREFLIGHT) {
  console.log("[preflight] Skipped via SNEEK_SKIP_PREFLIGHT=true");
  process.exit(0);
}

// Inspect parent process command line (best-effort)
const parentCmd = process.env.npm_lifecycle_event || "";
const argv = process.argv.join(" ");
const npmCmd = process.env.npm_config_argv || "";

const containsMigrate = (s) => /prisma\s+migrate\s+deploy/i.test(s);

const culprits = [
  ["argv", argv],
  ["npm_lifecycle_event", parentCmd],
  ["npm_config_argv", npmCmd],
].filter(([, v]) => containsMigrate(v));

if (culprits.length && !PRISMA_MIGRATE_GUARD) {
  console.error("");
  console.error("=".repeat(72));
  console.error("[preflight] REFUSING TO START");
  console.error("=".repeat(72));
  console.error("`prisma migrate deploy` was detected in the startup chain.");
  console.error("This is the May 2026 CPU-pin pattern. Multi-replica startup");
  console.error("migrations lock the DB and crash-loop containers.");
  console.error("");
  console.error("Detected in:");
  for (const [src, val] of culprits) {
    console.error(`  - ${src}: ${val}`);
  }
  console.error("");
  console.error("How to fix:");
  console.error("  1. Edit Dokploy UI (or your deploy script) so the start");
  console.error("     command is just `npm run start` — no migrate prefix");
  console.error("  2. Run migrations as a one-shot BEFORE deploy:");
  console.error("     docker exec <container> sh /app/scripts/migrate-once.sh");
  console.error("");
  console.error("To bypass this check (emergency only):");
  console.error("  Set SNEEK_ALLOW_STARTUP_MIGRATE=true on the container");
  console.error("=".repeat(72));
  console.error("");
  process.exit(1);
}

console.log("[preflight] OK");
process.exit(0);
