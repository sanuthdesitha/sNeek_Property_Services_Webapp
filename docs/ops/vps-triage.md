# VPS Performance Triage

When the VPS CPU is sustained high (sNeek prod has been pinned at ~97%),
run these on the server in order. The in-app counterpart is at
`/admin/system/diagnostics`.

## 1. What's eating CPU?

```bash
# Top processes by CPU
top -bn1 -o %CPU | head -20

# Or: ps with sort
ps aux --sort=-%cpu | head -20
```

Look for:

- Multiple `node` processes (orphaned containers from past deploys)
- Long-running `chrome`, `chromium`, `chrome_crashpad` (orphaned Playwright — should be fixed in `lib/reports/pdf.ts` after the perf patch)
- `ffmpeg` (orphaned video compression)
- `postgres` workers at 100% (long-running queries — also check `/admin/system/diagnostics`)

## 2. Memory pressure?

```bash
free -h
vmstat 1 5
```

High `si`/`so` (swap in/out) = swap thrashing = CPU at 97% on iowait.
Add RAM or reduce memory footprint. The in-app diagnostics page colours
`Heap > 700 MB` red — that's a leak signal.

## 3. Network connections (likely SSE leak)?

```bash
ss -tn state established | grep ":3000" | wc -l
```

If `> 100` active connections to port 3000, SSE connections are leaking.
The `/admin/ops` live map subscribes to SSE — if admins leave that tab
open without closing, each accumulates a connection.

The perf patch caps each connection's lifetime at 10 minutes and refuses
new connections beyond 50 per process. You can verify the current count
at `/admin/system/diagnostics` (SSE connections card).

## 4. Container resource usage

```bash
docker stats --no-stream
```

Identifies which container is the offender. If the sneek-ops container
shows 97%, drill into it:

```bash
docker exec <container> ps aux --sort=-%cpu | head -10
```

## 5. Database

Open psql:

```bash
psql "$DATABASE_URL" -c "SELECT pid, state, EXTRACT(EPOCH FROM (NOW() - query_start))::int AS seconds, LEFT(query, 200) FROM pg_stat_activity WHERE state != 'idle' ORDER BY query_start NULLS LAST LIMIT 20;"
```

Long-running queries (>30s) indicate missing indexes or runaway
operations.

Inspect pg-boss queue health:

```bash
psql "$DATABASE_URL" -c "SELECT state, COUNT(*) FROM pgboss.job GROUP BY state;"
```

Lots of jobs in `failed` or `retry` state = a handler is throwing on every
tick and pg-boss is hammering the DB. After the perf patch, every handler
is wrapped in `safeHandler()` which catches errors and prevents the retry
storm.

## 6. Application diagnostics page

Visit `/admin/system/diagnostics` in the browser (admin-only). Shows
real-time process stats, active SSE connections, queue state, recent
worker failures (in-process, last 20), and active Postgres queries.

Bands:

- **Green**: CPU <60%, heap <300 MB, no queries >10s, no failed jobs
- **Yellow**: CPU 60-85%, heap 300-700 MB, queries 10-30s, jobs retrying
- **Red**: CPU >85%, heap >700 MB, queries >30s, jobs in `failed` state

## 7. Emergency restart (if VPS is unresponsive)

```bash
docker restart <container>
# Or for a full systemd-managed service:
systemctl restart sneek-ops
```

Restart clears: orphaned Chromium processes, leaked SSE listeners,
swapped memory, pg-boss workers stuck on a bad job.

## 8. Reduce CPU baseline

- Run **pg-boss workers in a SEPARATE container** from the web app, so
  they can be restarted independently and don't compete with web request
  traffic. The worker entry point is `workers/boss.ts`.
- **Limit container CPU**: `docker run --cpus=2.0` so the container can't
  starve the host.
- **Enable Linux OOM-killer**: if the container leaks memory and hits
  OOM, killing it is preferable to swap thrashing.

## 9. Long-term: profile production

Install `clinic.js` or attach Node inspector temporarily during a
high-CPU window to get a flame graph of what's hot:

```bash
# In the container, expose the inspector
node --inspect=0.0.0.0:9229 .next/standalone/server.js

# On your laptop, port-forward then attach Chrome DevTools to
# chrome://inspect → "Open dedicated DevTools for Node"
ssh -L 9229:localhost:9229 user@vps
```

Take a CPU profile for 30-60 seconds during the high-CPU window. The top
of the flame graph will name the function on hot CPU.

## 10. Worker / web isolation

If workers and the web app share a Node process, a runaway worker job
(e.g. iCal sync stuck on a dead feed, or a Playwright PDF render that
won't release Chromium) directly steals CPU from web requests. The
user-facing symptom: pages slow + 97% CPU.

Recommended deployment topology:

- **Web container**: runs `npm start`. Handles HTTP requests only. Set
  `SNEEK_WORKERS_DISABLED=true` so even if the image accidentally ran
  `workers/boss.ts`, it would exit immediately.
- **Worker container**: runs `npx tsx workers/boss.ts` (or a
  `workers:start` script). Imports the same codebase but only registers
  pg-boss listeners.

`docker-compose.yml` snippet:

```yaml
services:
  web:
    image: sneek-ops-dashboard
    command: npm start
    environment:
      - SNEEK_WORKERS_DISABLED=true  # safety belt — guarantees web never spawns workers
    cpus: 2.0
    mem_limit: 1.5g
    restart: unless-stopped

  worker:
    image: sneek-ops-dashboard
    command: npx tsx workers/boss.ts
    cpus: 1.0
    mem_limit: 1g
    restart: unless-stopped
    depends_on:
      - postgres
```

Why this is the single highest-leverage perf change:

- Worker CPU spikes don't slow web requests.
- Restarting the worker container clears a stuck job (orphaned Chromium,
  hung iCal fetch, runaway loop) without dropping web traffic.
- Each container gets its own `--cpus` / `--memory` cap so the runaway
  cannot pin the entire host.

If you're currently running everything in a single container, switch to
this topology before chasing any other CPU optimization.

## 11. Kill switches — disable specific jobs without redeploying

The worker entry point honours three env vars defined in `workers/boss.ts`:

- **`SNEEK_WORKERS_ENABLED=true`** — **required** to actually run workers.
  This is the post-May-2026 inversion: workers are now OPT-IN. If this is
  not set to literally `"true"`, `main()` logs a warning and exits with
  status 0 immediately. The intent is that any new deploy / restart starts
  with all scheduled jobs OFF until ops explicitly turns them on, which
  guarantees no scheduled-job CPU draw can stack up unobserved.
- `SNEEK_WORKERS_DISABLED=true` — explicit force-disable that wins even
  when `SNEEK_WORKERS_ENABLED=true` is set. Use on the web container so a
  single image can serve both roles without the web process ever
  accidentally spawning pg-boss listeners.
- `SNEEK_DISABLED_JOBS="ical-sync,reminder-dispatch,recurring-job-generate"`
  — comma-separated list of job names to skip when registering schedules
  and workers. Use on the worker container to **bisect** which job is
  burning CPU:

  1. Disable the most suspicious job (start with `ical-sync` — it does
     network I/O across N feeds).
  2. Restart the worker container.
  3. Watch `top` / `/admin/system/diagnostics` for 10 minutes.
  4. If CPU dropped, you have your culprit. If not, re-enable that job
     and disable the next suspect.

Combine with the "Worker job runtime — last hour" card on
`/admin/system/diagnostics` for a faster diagnosis: any job at ≥25% of
an hour is almost certainly the offender. Disable that one first.

Job names match the strings passed to `boss.schedule()` and `boss.work()`
in `workers/boss.ts`. Current list:

```
ical-sync, reminder-dispatch, job-task-auto-approve, case-follow-up,
weekly-laundry-plan, stock-alerts, admin-attention-summary,
tomorrow-prep-dispatch, workforce-post-dispatch, email-campaign-dispatch,
marketing-campaign-dispatch, sla-escalation, safety-checkin-alerts,
recurring-job-generate, document-expiry-check, daily-invoice-generation,
recognition-check, report-generate, post-job-followup,
daily-ops-briefing, follow-up-1d, follow-up-3d, follow-up-14d,
google-reviews-refresh, location-pings-cleanup
```

## 12. Known fixes already shipped

| Issue | Fix | File |
| --- | --- | --- |
| SSE zombie connections | 10-min lifetime, 50-conn cap, 60s heartbeat, 15s poll (was 5s) | `app/api/admin/ops/live-locations/stream/route.ts` |
| pg-boss retry storm on a single failing handler | `safeHandler()` wrap + 10 min timeout | `workers/boss.ts` |
| iCal fetch hangs on dead feed | 15s `AbortController` timeout | `lib/ical/sync.ts` |
| Concurrent Chromium instances | Single-flight semaphore + 60s total timeout + explicit `page` / `context` close | `lib/reports/pdf.ts` |
| GPS ping flood from buggy client | 10s per-user rate limit + reject pings older than 5 min | `app/api/cleaner/location/ping/route.ts` |

## 13. Detecting CPU steal time (hypervisor throttling)

If the VPS host node is oversold, the hypervisor takes CPU cycles away from your VM
to give to other tenants. From inside the VM this LOOKS identical to "97% CPU used"
but no amount of optimization fixes it — only migrating to a less-loaded host node
or upgrading to a CPU-dedicated tier.

### Detect

```bash
top -bn1 | head -3
```

Look at the third line:

```
%Cpu(s):  5.0 us,  5.0 sy,  0.0 ni,  0.0 id,  0.0 wa,  0.0 hi,  0.0 si, 90.0 st
```

The `st` value is steal time as a percent. Any value > 5% is concerning. > 25% is
crippling. Combined with high load average and low userland CPU, it's diagnostic.

Or visit `/admin/system/diagnostics` — the page surfaces this in a red panic banner
when steal time exceeds 25%, and the `CPU steal` stat tile shows the live percent at
all times. The page also surfaces the 1m/5m/15m Linux load averages and free RAM so
you can sanity-check the hypervisor's story against the in-VM view.

### Fix

1. Contact your VPS provider — most will migrate the VM to a less-loaded host node
   for free if you point out the steal time number.
2. Upgrade to a CPU-dedicated tier:
   - Hetzner Cloud CPX (dedicated vCPU)
   - DigitalOcean CPU-Optimized droplets
   - AWS EC2 c-series
   - Linode Dedicated CPU
   - Vultr High Frequency
3. Do not waste time optimizing application code — steal time is not affected by
   application changes.
