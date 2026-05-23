# Plan F — Email Deliverability + Live GPS Tracking

**Goal (email):** DNS audit, suppression list via webhook, admin email funnel dashboard, gated sends for non-transactional categories.

**Goal (GPS):** Cleaner batched location pings, IndexedDB queue when offline, SSE live stream to admin map, geofence auto-arrival/departure, staleness-colored markers.

**Architecture:** Email — Resend webhook → `EmailStatus` enum on User (added Plan A). GPS — `watchPosition` → batched POST → SSE broadcast → admin map subscription. Geofence checks ping against active job's property lat/lng (from Plan D backfill).

---

## EMAIL track

### Task 1: DNS audit doc

**Files:** `docs/ops/email.md`

- [ ] Document current SPF/DKIM/DMARC for sending domain. Capture 30-day Resend funnel stats.

### Task 2: Suppression library

**Files:** `lib/email/suppression.ts`, `tests/lib/suppression.test.ts`

- [ ] `isSuppressed(email)`, `suppress(email, reason)`, `unsuppress(email)`. Reads/writes `User.emailStatus`.

### Task 3: Resend webhook handler

**Files:** `app/api/integrations/resend/webhook/route.ts`

- [ ] Verify signature (Resend uses SVIX). On `email.bounced` → suppress (soft or hard based on payload). On `email.complained` → suppress (COMPLAINT). Log to `NotificationLog`.

### Task 4: Gate send paths

**Files:** modify `lib/notifications/email.ts`

- [ ] Add `transactional` flag. If non-transactional and `isSuppressed(to)` → skip + log.

### Task 5: Admin email page

**Files:** `app/admin/system/email/page.tsx`, `app/api/admin/system/email/route.ts`

- [ ] 30-day funnel chart (sent / delivered / opened / bounced / complained). Suppression list with unsuppress action. Dead-letter queue.

---

## GPS track

### Task 6: Cleaner ping client

**Files:** `lib/gps/queue.ts`, `lib/gps/client.tsx`, modify `app/cleaner/jobs/[id]/page.tsx` (or shell)

- [ ] On job start, prompt for geolocation permission (with persistent banner on denial). Start `watchPosition`. Batch pings every 30s. IndexedDB queue when offline. Flush on reconnect.

### Task 7: Ping API + SSE

**Files:** `app/api/cleaner/location/ping/route.ts` (modify to accept array), `app/api/admin/ops/live-locations/stream/route.ts` (new SSE)

- [ ] Batch POST writes to `CleanerLocationPing`. Denormalizes `User.lastSeenAt`. SSE channel broadcasts new pings to subscribed admins.

### Task 8: Geofence

**Files:** `lib/gps/geofence.ts`

- [ ] On new ping, find active job for user. If property has lat/lng AND ping within 75m AND TimeLog.arrivedAt null → set arrivedAt. Equivalent for departedAt. Threshold configurable in AppSetting.

### Task 9: Admin map redesign

**Files:** `app/admin/ops/map/page.tsx`, `components/ops/live-map.tsx`

- [ ] Subscribe via SSE. Markers: avatar pin + accuracy circle + staleness color (green <2m, amber 2-10m, red >10m). Click marker → side panel with name, current job, ETA, battery, time on site.

### Task 10: Full verification + push + PR
