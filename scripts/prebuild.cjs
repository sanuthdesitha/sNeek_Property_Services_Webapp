const { spawnSync } = require("node:child_process");

const buildEnv = { ...process.env };

if (process.env.BUILD_DATABASE_URL) {
  buildEnv.DATABASE_URL = process.env.BUILD_DATABASE_URL;
}

if (process.env.BUILD_DIRECT_URL) {
  buildEnv.DIRECT_URL = process.env.BUILD_DIRECT_URL;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: buildEnv,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("npm", ["run", "db:generate"]);
run("npm", ["run", "db:deploy"]);
run("npm", ["run", "admin:bootstrap"]);

if (process.env.RUN_PLAYWRIGHT_INSTALL_ON_BUILD === "1") {
  run("npm", ["run", "playwright:install"]);
} else {
  console.log("prebuild: skipping Playwright browser install (set RUN_PLAYWRIGHT_INSTALL_ON_BUILD=1 to enable)");
}
