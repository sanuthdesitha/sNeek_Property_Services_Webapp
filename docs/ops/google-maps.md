# Google Maps Setup (Ops Runbook)

This doc covers Google Cloud configuration for the Maps + Places integration used by
`AddressAutocomplete`, the `/api/geocode/lookup` server proxy, and the backfill
script (`scripts/backfill/geocode-addresses.ts`).

## APIs to enable

In the Google Cloud Console (project: `sneek-ops` or equivalent), enable:

1. **Places API (New)** — used by both the browser-side Autocomplete widget and
   the server-side text search proxy. The "New" variant uses
   `places.googleapis.com/v1/...` endpoints with `X-Goog-FieldMask` headers.
2. **Maps JavaScript API** — required for `@googlemaps/js-api-loader` to load
   the `places` library in the browser. We don't render maps yet, but the loader
   needs this to be enabled.

Optional / not currently used:

- Geocoding API — we use Places Text Search instead, which returns richer
  structured address components.
- Geolocation API — not needed; browser `navigator.geolocation` covers our
  cleaner-side pings (Plan F).

## API key strategy

### Current setup (single key)

Today the app uses a single env var, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, for both:

- Browser-side `Loader` (visible in network requests, leaks into the JS bundle).
- Server-side proxy `/api/geocode/lookup` and the backfill script.

This is fine to ship, but it's a **trade-off**: any HTTP-referrer restriction
we put on the key will break the server-side calls (server has no `Referer`).
Conversely, any IP restriction will break the browser usage. As a result the
single key today has **no restrictions** (or very loose ones) — which is
acceptable because Places-API-New has built-in quota limits and we set budget
alerts (below). Recommended hardening follow-up is to split the key into two:

### Recommended (two-key) setup

1. **Browser key** — `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`
   - Application restriction: **HTTP referrers**
   - Allow these referrers:
     - `https://sneekproservices.com.au/*`
     - `https://*.sneekproservices.com.au/*`
     - `http://localhost:3000/*` (dev only — remove for prod-only keys)
   - API restriction: **Maps JavaScript API, Places API (New)**.

2. **Server key** — `GOOGLE_MAPS_SERVER_KEY` (new env var, not yet wired)
   - Application restriction: **IP addresses**
   - Allow the production VPS IP only.
   - API restriction: **Places API (New)** (no JS Maps needed server-side).

When we split, the `/api/geocode/lookup` route and `scripts/backfill/geocode-addresses.ts`
should both read `process.env.GOOGLE_MAPS_SERVER_KEY` and fall back to
`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` for local dev.

## Budget alerts

In Cloud Billing → Budgets & alerts, create a budget for the Maps project:

- **Budget amount:** $20 / month.
- **Alert thresholds:**
  - 50% ($10) — email ops@sneekproservices.com.au
  - 90% ($18) — email + Slack
  - 100% ($20) — email + Slack + SMS to on-call
- **Daily soft alert:** also set a programmatic alert at $5/day. Anything over
  $5/day on Maps spend almost certainly indicates a bug (infinite re-render in
  Autocomplete, abusive client, backfill script left running). Investigate the
  same day.

## Cost model (rough)

As of late 2025 pricing for Places API (New):

- **Autocomplete (per session):** ~$0.017 per completed session (debounced
  keystrokes count as one session if a place is selected within ~30s).
- **Place Details / Text Search:** ~$0.017 per request.
- **Free monthly credit:** $200 (covers ~12k autocomplete sessions).

At our current usage (~30 quotes/day, ~10 new properties/week, ~50 cleaner
profile edits/year) we will stay comfortably within the $200 free tier. The
$20/mo cap is a guardrail against runaway bugs, not an expected spend.

## Operational checklist

- [ ] Enable Places API (New) in Cloud Console.
- [ ] Enable Maps JavaScript API.
- [ ] Create API key, copy into `.env` as `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.
- [ ] Set monthly budget = $20 with alerts at 50/90/100%.
- [ ] Set daily soft alert at $5.
- [ ] **Later:** split key into browser + server keys per the "Recommended"
      section above.

## Failure modes

- **Key missing / not configured:** `AddressAutocomplete` shows the fallback
  "Address lookup unavailable — type the address manually." notice. Forms keep
  working with manual entry.
- **Quota exhausted:** Google returns 429. Server proxy returns 502 with the
  Google error text. Same client fallback applies.
- **Bad address (no result):** Server proxy returns 404. UI continues with the
  text the user typed; lat/lng/placeId stay null.
- **Geocode failures during backfill:** logged to the `GeocodeFailure` table for
  later review. Run `select * from "GeocodeFailure" where "resolvedAt" is null;`
  to see what needs manual cleanup.
