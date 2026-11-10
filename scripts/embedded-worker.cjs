// Supervises the automation worker beside the web server.
//
// A single-container deployment (the Dockerfile CMD, or a platform start
// command of `npm run start`) starts only Next.js. Since page rendering no
// longer runs scheduled work, such a deployment would run no automation at
// all: no iCal sync, reminders, notification dispatch or sweeps. This
// supervisor closes that gap by running workers/boss.ts as a sibling process.
//
// It is a separate process from the web server, so a worker crash, hang or
// memory spike cannot take request handling down with it. pg-boss delivers
// each scheduled job once, so this is safe beside a dedicated worker service
// and across web replicas.

const path = require("node:path");
const { spawn } = require("node:child_process");

const MIN_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 5 * 60_000;
// A worker that stayed up this long is treated as healthy; its next failure
// starts again from the shortest delay.
const STABLE_RUN_MS = 10 * 60_000;
const PARENT_POLL_MS = 5_000;

/**
 * Operator switches, strongest first. The pre-existing master kill switch and
 * the old "no automation in the web container" flag both still win.
 */
function embeddedWorkerDecision(env) {
  if (env.SNEEK_WORKERS_DISABLED === "true") {
    return { run: false, reason: "SNEEK_WORKERS_DISABLED=true" };
  }
  if (env.SNEEK_EMBEDDED_WORKER === "false") {
    return { run: false, reason: "SNEEK_EMBEDDED_WORKER=false" };
  }
  if (env.SNEEK_WORKERS_ENABLED === "false") {
    return { run: false, reason: "SNEEK_WORKERS_ENABLED=false" };
  }
  if (env.SNEEK_WEB_SCHEDULER_ENABLED === "false") {
    return { run: false, reason: "SNEEK_WEB_SCHEDULER_ENABLED=false" };
  }
  if (!env.DATABASE_URL) {
    return { run: false, reason: "DATABASE_URL is not set" };
  }
  return { run: true, reason: "single-container default" };
}

function nextBackoffMs(previousMs, ranForMs) {
  if (ranForMs >= STABLE_RUN_MS) return MIN_BACKOFF_MS;
  if (!previousMs) return MIN_BACKOFF_MS;
  return Math.min(previousMs * 2, MAX_BACKOFF_MS);
}

function workerEnvironment(env) {
  return { ...env, SNEEK_WORKERS_ENABLED: "true" };
}

function workerCommand(cwd) {
  const tsxCli = path.resolve(cwd, "node_modules", "tsx", "dist", "cli.mjs");
  return [tsxCli, "--tsconfig", "tsconfig.scripts.json", "workers/boss.ts"];
}

function parentAlive(parentPid) {
  try {
    process.kill(parentPid, 0);
    return true;
  } catch {
    return false;
  }
}

function supervise() {
  const decision = embeddedWorkerDecision(process.env);
  if (!decision.run) {
    console.log(`[embedded-worker] Not starting (${decision.reason}).`);
    return;
  }

  const parentPid = process.ppid;
  let child = null;
  let backoffMs = 0;
  let restartTimer = null;
  let stopping = false;

  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    if (restartTimer) clearTimeout(restartTimer);
    if (child && child.exitCode === null) child.kill(signal);
    else process.exit(0);
  };

  const start = () => {
    restartTimer = null;
    const startedAt = Date.now();
    console.log("[embedded-worker] Starting automation worker.");
    child = spawn(process.execPath, workerCommand(process.cwd()), {
      stdio: "inherit",
      env: workerEnvironment(process.env),
    });
    child.on("error", (error) => {
      console.error(`[embedded-worker] Could not start worker: ${error.message}`);
    });
    child.on("exit", (code, signal) => {
      if (stopping) process.exit(0);
      // The worker exits 0 only when an operator switch told it to stand down.
      if (code === 0) {
        console.log("[embedded-worker] Worker stood down; not restarting.");
        process.exit(0);
      }
      backoffMs = nextBackoffMs(backoffMs, Date.now() - startedAt);
      console.error(
        `[embedded-worker] Worker exited (code ${code ?? "none"}, signal ${signal ?? "none"}). ` +
          `Restarting in ${Math.round(backoffMs / 1000)}s.`,
      );
      restartTimer = setTimeout(start, backoffMs);
    });
  };

  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
  // Never outlive the web server that launched this supervisor.
  setInterval(() => {
    if (process.ppid !== parentPid || !parentAlive(parentPid)) stop("SIGTERM");
  }, PARENT_POLL_MS);

  start();
}

module.exports = { embeddedWorkerDecision, nextBackoffMs, workerEnvironment, workerCommand };

if (require.main === module) supervise();
