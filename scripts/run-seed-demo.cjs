const { spawnSync } = require("node:child_process");

const result = spawnSync(
  "tsx",
  ["--tsconfig", "tsconfig.scripts.json", "prisma/seed.ts"],
  {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      SEED_INCLUDE_DEMO: "1",
    },
  }
);

process.exit(result.status ?? 1);
