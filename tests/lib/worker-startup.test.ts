// @vitest-environment node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const compose = readFileSync(resolve(root, "docker-compose.yml"), "utf8");
const workerCommand = compose.match(/npx tsx ([^"\n]+workers\/boss\.ts)/)?.[1];

describe("standalone worker startup", () => {
  it.each([
    { enabled: "false", disabled: "false", message: "Workers DISABLED by default" },
    { enabled: "true", disabled: "true", message: "Workers explicitly disabled" },
  ])("loads real server imports and honors $enabled/$disabled safety flags", ({ enabled, disabled, message }) => {
    expect(workerCommand).toBeDefined();
    // Exercise the actual Compose tsx arguments without Vitest's server-only alias.
    // A closed loopback port prevents accidental use of a real database.
    const result = spawnSync(process.execPath, [
      "node_modules/tsx/dist/cli.mjs", ...workerCommand!.split(/\s+/),
    ], {
      cwd: root,
      env: {
        ...process.env,
        NODE_OPTIONS: "",
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unused",
        SNEEK_WORKERS_ENABLED: enabled,
        SNEEK_WORKERS_DISABLED: disabled,
      },
      encoding: "utf8",
      timeout: 20_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout + result.stderr).toContain(message);
  }, 25_000);

  it("uses the same CLI config for development and leaves Next's guard intact", () => {
    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    expect(pkg.scripts["workers:dev"]).toContain("tsx watch --tsconfig tsconfig.scripts.json workers/boss.ts");
    expect(readFileSync(resolve(root, "tsconfig.json"), "utf8")).not.toContain('"server-only"');
  });
});
