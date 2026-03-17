const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const mode = process.argv[2];

if (!mode || !["build", "start", "dev"].includes(mode)) {
  console.error("Usage: node ./scripts/run-next.cjs <build|start|dev> [args...]");
  process.exit(1);
}

const forwardedArgs = process.argv.slice(3);
const env = { ...process.env };

if (mode === "build" || mode === "start") {
  env.NEXT_DIST_DIR = env.NEXT_DIST_DIR || ".next-prod";
}

if (mode === "build") {
  const distDir = path.resolve(process.cwd(), env.NEXT_DIST_DIR);
  fs.rmSync(distDir, { recursive: true, force: true });
}

const nextBin = path.resolve(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const patch = path.resolve(process.cwd(), "scripts", "fs-readlink-patch.cjs");
const args = ["-r", patch, nextBin, mode, ...forwardedArgs];

const result = spawnSync(process.execPath, args, {
  stdio: "inherit",
  shell: false,
  env,
});

process.exit(result.status ?? 1);
