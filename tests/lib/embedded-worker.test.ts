// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const supervisor = require("../../scripts/embedded-worker.cjs") as {
  embeddedWorkerDecision: (env: Record<string, string | undefined>) => { run: boolean; reason: string };
  nextBackoffMs: (previousMs: number, ranForMs: number) => number;
  workerEnvironment: (env: Record<string, string | undefined>) => Record<string, string | undefined>;
  workerCommand: (cwd: string) => string[];
};

const DATABASE_URL = "postgresql://unused:unused@127.0.0.1:1/unused";

describe("embedded automation worker", () => {
  it("runs by default in a single-container deployment", () => {
    expect(supervisor.embeddedWorkerDecision({ DATABASE_URL })).toEqual({
      run: true,
      reason: "single-container default",
    });
  });

  it.each([
    ["SNEEK_WORKERS_DISABLED", "true"],
    ["SNEEK_EMBEDDED_WORKER", "false"],
    ["SNEEK_WORKERS_ENABLED", "false"],
    ["SNEEK_WEB_SCHEDULER_ENABLED", "false"],
  ])("stands down when an operator sets %s=%s", (name, value) => {
    const decision = supervisor.embeddedWorkerDecision({ DATABASE_URL, [name]: value });
    expect(decision.run).toBe(false);
    expect(decision.reason).toBe(`${name}=${value}`);
  });

  it("does not start without a database", () => {
    expect(supervisor.embeddedWorkerDecision({}).run).toBe(false);
  });

  it("opts the child worker in without overriding the kill switches", () => {
    const env = supervisor.workerEnvironment({ DATABASE_URL, SNEEK_DISABLED_JOBS: "ical-sync" });
    expect(env.SNEEK_WORKERS_ENABLED).toBe("true");
    expect(env.SNEEK_DISABLED_JOBS).toBe("ical-sync");
    expect(env.SNEEK_WORKERS_DISABLED).toBeUndefined();
  });

  it("uses the same worker arguments as the dedicated service", () => {
    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    const args = supervisor.workerCommand(root).slice(1).join(" ");
    expect(pkg.scripts["workers:start"]).toBe(`tsx ${args}`);
  });

  it("backs off after repeated crashes and resets after a stable run", () => {
    expect(supervisor.nextBackoffMs(0, 1_000)).toBe(5_000);
    expect(supervisor.nextBackoffMs(5_000, 1_000)).toBe(10_000);
    expect(supervisor.nextBackoffMs(4 * 60_000, 1_000)).toBe(5 * 60_000);
    expect(supervisor.nextBackoffMs(5 * 60_000, 11 * 60_000)).toBe(5_000);
  });

  it("is launched by the production start command only", () => {
    const runner = readFileSync(resolve(root, "scripts/run-next.cjs"), "utf8");
    expect(runner).toMatch(/if \(mode === "start"\) \{[\s\S]*embedded-worker\.cjs/);
  });

  it("keeps the dedicated Compose web service free of an embedded worker", () => {
    const compose = readFileSync(resolve(root, "docker-compose.yml"), "utf8");
    const web = compose.slice(compose.indexOf("  web:"), compose.indexOf("  worker:"));
    expect(web).toContain('SNEEK_WORKERS_DISABLED: "true"');
  });
});
