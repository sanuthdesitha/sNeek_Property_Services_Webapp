const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const buildEnv = { ...process.env };

function canReuseGeneratedPrismaClient() {
  const clientDir = path.join(process.cwd(), "node_modules", ".prisma", "client");
  const requiredFiles = ["index.js", "default.js", "index.d.ts", "query_engine-windows.dll.node"];

  return requiredFiles.every((file) => fs.existsSync(path.join(clientDir, file)));
}

function runGenerateSafely() {
  const result = spawnSync("npm", ["run", "db:generate"], {
    shell: process.platform === "win32",
    env: buildEnv,
    encoding: "utf8",
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.status === 0) {
    return;
  }

  if (process.platform === "win32" && canReuseGeneratedPrismaClient()) {
    console.warn(
      "runtime: reusing the existing Prisma client because Windows is locking the Prisma engine file during generate."
    );
    return;
  }

  process.exit(result.status ?? 1);
}

runGenerateSafely();
