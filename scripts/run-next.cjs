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
const requestedDistDir = env.NEXT_DIST_DIR || (mode === "build" || mode === "start" ? ".next-prod" : ".next");
const stagedBuildDistDir = `${requestedDistDir}.__build`;
const tsconfigPath = path.resolve(process.cwd(), "tsconfig.json");
const tsconfigSnapshot =
  mode === "build" && fs.existsSync(tsconfigPath) ? fs.readFileSync(tsconfigPath, "utf8") : null;

if (mode === "build" || mode === "start") {
  env.NEXT_DIST_DIR = requestedDistDir;
}

if (mode === "build") {
  env.NEXT_DIST_DIR = stagedBuildDistDir;
  const stagedDistDir = path.resolve(process.cwd(), stagedBuildDistDir);
  fs.rmSync(stagedDistDir, { recursive: true, force: true });
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

  fs.rmSync(backupDistDir, { recursive: true, force: true });

  try {
    if (fs.existsSync(finalDistDir)) {
      fs.renameSync(finalDistDir, backupDistDir);
    }
    fs.renameSync(stagedDistDir, finalDistDir);
    fs.rmSync(backupDistDir, { recursive: true, force: true });
  } catch (error) {
    if (fs.existsSync(backupDistDir) && !fs.existsSync(finalDistDir)) {
      try {
        fs.renameSync(backupDistDir, finalDistDir);
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
