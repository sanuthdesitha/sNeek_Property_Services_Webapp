// @vitest-environment node
import { createServer } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { expect, it } from "vitest";

// This deliberately waits for wall-clock cron ticks. Run alone against a fresh
// disposable migrated database; never enable it against shared/browser fixtures.
it.skipIf(process.env.ICAL_SCHEDULE_SMOKE !== "1")("executes two unattended cron intervals through the real worker and pg-boss", async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (url.hostname !== "127.0.0.1" || url.port !== "55439" || url.pathname !== "/ical_unattended") {
    throw new Error("Fresh isolated 127.0.0.1:55439/ical_unattended database required");
  }
  const db = new PrismaClient();
  let child: ChildProcess | undefined;
  let logs = "";
  let fetches = 0;
  const server = createServer((_request, response) => { fetches += 1; response.writeHead(304); response.end(); });
  const waitFor = async (predicate: () => Promise<boolean>, timeoutMs: number) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (child && child.exitCode !== null) throw new Error(`Worker exited: ${logs}`);
      if (await predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error(`Unattended scheduler timed out: ${logs}`);
  };
  try {
    expect(await db.integration.count()).toBe(0);
    expect(await db.job.count()).toBe(0);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture feed did not listen");
    const property = await db.property.create({ data: {
      name: "Unattended scheduler fixture", address: "Fixture", suburb: "Fixture",
      client: { create: { name: "Scheduler fixture" } },
      integration: { create: { isEnabled: true, icalUrl: `http://127.0.0.1:${address.port}/fixture.ics` } },
    } });
    child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "--tsconfig", "tsconfig.scripts.json", "workers/boss.ts"], {
      cwd: resolve(__dirname, "../.."), detached: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NODE_OPTIONS: "", NODE_ENV: "production", SNEEK_WORKERS_ENABLED: "true",
        SNEEK_WORKERS_DISABLED: "false", SNEEK_ENABLED_JOBS: "ical-sync", SNEEK_DISABLED_JOBS: "" },
    });
    child.stdout?.on("data", chunk => { logs += chunk.toString(); });
    child.stderr?.on("data", chunk => { logs += chunk.toString(); });
    await waitFor(async () => logs.includes("All workers registered"), 20_000);
    const schedules = await db.$queryRawUnsafe<Array<{ name: string; cron: string; timezone: string }>>("SELECT name, cron, timezone FROM pgboss.schedule");
    expect(schedules).toEqual([{ name: "ical-sync", cron: "0 */4 * * *", timezone: "Australia/Sydney" }]);
    // Accelerate only this disposable DB's cron row. No send(), handler call,
    // manual endpoint, page render, or application cadence override is used.
    await db.$executeRawUnsafe("UPDATE pgboss.schedule SET cron = '* * * * *' WHERE name = 'ical-sync'");
    const startedAt = new Date();
    await waitFor(async () => await db.icalSyncRun.count({ where: { propertyId: property.id, mode: "AUTO", status: "SUCCESS", createdAt: { gte: startedAt } } }) >= 2, 160_000);
    const runs = await db.icalSyncRun.findMany({ where: { propertyId: property.id }, orderBy: { createdAt: "asc" } });
    expect(runs.length).toBeGreaterThanOrEqual(2);
    for (const run of runs) expect(run).toMatchObject({ mode: "AUTO", status: "SUCCESS", triggeredById: null });
    expect(runs[1].createdAt.getTime() - runs[0].createdAt.getTime()).toBeGreaterThan(50_000);
    expect(fetches).toBe(runs.length);
    expect(await db.icalSyncRun.count({ where: { mode: "MANUAL" } })).toBe(0);
    expect((await db.integration.findUnique({ where: { propertyId: property.id } }))?.lastSyncAt).not.toBeNull();
    expect(await db.job.count()).toBe(0);
    expect(await db.laundryTask.count()).toBe(0);
    expect(await db.clientInvoice.count()).toBe(0);
    console.log(JSON.stringify({ evidence: "real unattended cron", acceleratedFixtureCadence: "every minute", productionCadence: "0 */4 * * * Australia/Sydney", runs: runs.map(run => ({ mode: run.mode, status: run.status, createdAt: run.createdAt, completedAt: run.completedAt })), fetches }));
  } finally {
    if (child?.pid && child.exitCode === null) process.kill(-child.pid, "SIGTERM");
    await new Promise<void>(resolve => server.close(() => resolve()));
    await db.$disconnect();
  }
}, 190_000);
