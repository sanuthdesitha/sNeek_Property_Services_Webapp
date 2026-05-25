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

## 10. Known fixes already shipped

| Issue | Fix | File |
| --- | --- | --- |
| SSE zombie connections | 10-min lifetime, 50-conn cap, 60s heartbeat, 15s poll (was 5s) | `app/api/admin/ops/live-locations/stream/route.ts` |
| pg-boss retry storm on a single failing handler | `safeHandler()` wrap + 10 min timeout | `workers/boss.ts` |
| iCal fetch hangs on dead feed | 15s `AbortController` timeout | `lib/ical/sync.ts` |
| Concurrent Chromium instances | Single-flight semaphore + 60s total timeout + explicit `page` / `context` close | `lib/reports/pdf.ts` |
| GPS ping flood from buggy client | 10s per-user rate limit + reject pings older than 5 min | `app/api/cleaner/location/ping/route.ts` |
