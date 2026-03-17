const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const buildEnv = { ...process.env };

if (process.env.BUILD_DATABASE_URL) {
  buildEnv.DATABASE_URL = process.env.BUILD_DATABASE_URL;
}

if (process.env.BUILD_DIRECT_URL) {
  buildEnv.DIRECT_URL = process.env.BUILD_DIRECT_URL;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: buildEnv,
    ...options,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function canReuseGeneratedPrismaClient() {
  const clientDir = path.join(process.cwd(), "node_modules", ".prisma", "client");
  const requiredFiles = ["index.js", "index.d.ts", "query_engine-windows.dll.node"];

  return requiredFiles.every((file) => fs.existsSync(path.join(clientDir, file)));
}

function runGenerateSafely() {
  const result = spawnSync("npm", ["run", "db:generate"], {
    shell: process.platform === "win32",
    env: buildEnv,
    encoding: "utf8",
  });

  if (result.status === 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    return;
  }

  if (process.platform === "win32" && canReuseGeneratedPrismaClient()) {
    console.warn(
      "prebuild: reusing the existing Prisma client because Windows is locking the Prisma engine file during generate."
    );
    return;
  }

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

runGenerateSafely();
run("npm", ["run", "db:deploy"]);
run("npm", ["run", "admin:bootstrap"]);

if (process.env.RUN_PLAYWRIGHT_INSTALL_ON_BUILD === "1") {
  run("npm", ["run", "playwright:install"]);
} else {
  console.log("prebuild: skipping Playwright browser install (set RUN_PLAYWRIGHT_INSTALL_ON_BUILD=1 to enable)");
}
