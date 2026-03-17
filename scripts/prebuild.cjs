const { spawnSync } = require("node:child_process");

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("npm", ["run", "db:generate"]);

if (process.env.RUN_DB_DEPLOY_ON_BUILD === "1") {
  run("npm", ["run", "db:deploy"]);
  run("npm", ["run", "admin:bootstrap"]);
} else {
  console.log("prebuild: skipping db deploy/admin bootstrap (set RUN_DB_DEPLOY_ON_BUILD=1 to enable)");
}

if (process.env.RUN_PLAYWRIGHT_INSTALL_ON_BUILD === "1") {
  run("npm", ["run", "playwright:install"]);
} else {
  console.log("prebuild: skipping Playwright browser install (set RUN_PLAYWRIGHT_INSTALL_ON_BUILD=1 to enable)");
}
