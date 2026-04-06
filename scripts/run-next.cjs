const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const mode = process.argv[2];

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function removePathSync(targetPath) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!error || !["ENOTEMPTY", "EPERM", "EBUSY"].includes(error.code)) {
        throw error;
      }
      sleep(150 * (attempt + 1));
    }
  }

  if (fs.existsSync(targetPath)) {
    throw new Error(`Could not remove path: ${targetPath}`);
  }
}

function movePathSync(sourcePath, targetPath) {
  try {
    fs.renameSync(sourcePath, targetPath);
    return;
  } catch (error) {
    if (error && error.code !== "EXDEV") {
      throw error;
    }
  }

  fs.cpSync(sourcePath, targetPath, {
    recursive: true,
    force: true,
    errorOnExist: false,
  });
  fs.rmSync(sourcePath, { recursive: true, force: true });
}

if (!mode || !["build", "start", "dev"].includes(mode)) {
  console.error("Usage: node ./scripts/run-next.cjs <build|start|dev> [args...]");
  process.exit(1);
}

const forwardedArgs = process.argv.slice(3);
const env = { ...process.env };
const requestedDistDir = env.NEXT_DIST_DIR || (mode === "build" || mode === "start" ? ".next-prod" : ".next-dev");
const stagedBuildDistDir = `${requestedDistDir}.__build`;
const tsconfigPath = path.resolve(process.cwd(), "tsconfig.json");
const tsconfigSnapshot =
  (mode === "build" || mode === "dev") && fs.existsSync(tsconfigPath) ? fs.readFileSync(tsconfigPath, "utf8") : null;

if (mode === "build" || mode === "start" || mode === "dev") {
  env.NEXT_DIST_DIR = requestedDistDir;
}

if (mode === "dev") {
  const devDistDir = path.resolve(process.cwd(), requestedDistDir);
  removePathSync(devDistDir);
}

if (mode === "build") {
  env.NEXT_DIST_DIR = stagedBuildDistDir;
  const stagedDistDir = path.resolve(process.cwd(), stagedBuildDistDir);
  removePathSync(stagedDistDir);
}

const nextBin = path.resolve(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const patch = path.resolve(process.cwd(), "scripts", "fs-readlink-patch.cjs");
const args = ["-r", patch, nextBin, mode, ...forwardedArgs];

const result = spawnSync(process.execPath, args, {
  stdio: "inherit",
  shell: false,
  env,
});

if (tsconfigSnapshot !== null) {
  const currentTsconfig = fs.existsSync(tsconfigPath) ? fs.readFileSync(tsconfigPath, "utf8") : null;
  if (currentTsconfig !== tsconfigSnapshot) {
    fs.writeFileSync(tsconfigPath, tsconfigSnapshot, "utf8");
  }
}

if (mode === "build" && result.status === 0) {
  const finalDistDir = path.resolve(process.cwd(), requestedDistDir);
  const stagedDistDir = path.resolve(process.cwd(), stagedBuildDistDir);
  const backupDistDir = path.resolve(process.cwd(), `${requestedDistDir}.__previous`);

  removePathSync(backupDistDir);

  try {
    if (fs.existsSync(finalDistDir)) {
      movePathSync(finalDistDir, backupDistDir);
    }
    movePathSync(stagedDistDir, finalDistDir);
    removePathSync(backupDistDir);
  } catch (error) {
    if (fs.existsSync(backupDistDir) && !fs.existsSync(finalDistDir)) {
      try {
        movePathSync(backupDistDir, finalDistDir);
      } catch {}
    }

    console.error(
      [
        `Build completed in ${stagedBuildDistDir} but could not activate it as ${requestedDistDir}.`,
        "The current production build is probably still in use by a running server.",
        "Stop the running app and run `npm run build` again so the new build can be promoted cleanly.",
      ].join(" ")
    );
    console.error(error);
    process.exit(1);
  }
}

process.exit(result.status ?? 1);
