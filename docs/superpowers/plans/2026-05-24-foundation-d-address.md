# Plan D — Google Maps Address Autocomplete

**Goal:** Ship `<AddressAutocomplete>` component using Google Places (New) API, wire into every address surface (register, profile, property create/edit, quote create, job create, lead form), backfill existing rows with lat/lng.

**Architecture:** Browser-side Places JS SDK with debounced autocomplete. Server-side proxy for sensitive flows (backfill). Normalized `AddressResult` shape stored on Property/User/Client lat/lng/placeId/suburb/state/postcode columns (from Plan A).

**Tech Stack:** `@googlemaps/js-api-loader` (installed Plan A), Google Places API (New), browser-side Places Autocomplete, server-side Places Details endpoint via fetch.

---

## Prerequisites

1. Plan A merged.
2. Google Cloud project + API key (browser-restricted to project domain + server-side key); user creates these and provides `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` + `GOOGLE_MAPS_API_KEY` in `.env`.
3. Plan B + C merged for new tokens + form-field primitive (consumed by autocomplete UI).

---

## Task 1: Google Cloud setup doc

**Files:** `docs/ops/google-maps.md`

- [ ] Document: which APIs to enable (Places API New, Maps JS API), how to create restricted browser key + unrestricted server key, daily quota + budget alert (set to $20 AUD/mo to start).

## Task 2: Maps client wrapper

**Files:** `lib/google-maps/client.ts`, `tests/lib/google-maps.test.ts`

- [ ] Singleton loader (`@googlemaps/js-api-loader`). Only loads on first use. Handles SSR (no-op).
- [ ] Exports `loadPlacesService()`, `parsePlaceResult(place): AddressResult`.
- [ ] `AddressResult` type from spec §10.1: `{formattedAddress, streetNumber?, route?, unit?, suburb?, state?, postcode?, country, lat, lng, placeId}`.

## Task 3: AddressAutocomplete component

**Files:** `components/ui/address-autocomplete.tsx`, `tests/components/address-autocomplete.test.tsx`

- [ ] Controlled input wrapping Places Autocomplete. AU country bias. Returns full `AddressResult` on selection.
- [ ] Uses `FormField` primitive (Plan B) for label/hint/error.
- [ ] Loading state while SDK loads. Fallback to plain text input if API fails.
- [ ] Test: mocked Places API returns selection, component dispatches normalized shape.

## Task 4: Server-side geocode proxy

**Files:** `app/api/geocode/lookup/route.ts`

- [ ] POST with `{ query: string }`, calls Places Text Search server-side, returns `AddressResult`. Auth: admin or backend-service only.
- [ ] Used by backfill script (Task 6).

## Task 5: Wire into all address surfaces

**Files (modify):**
- Register flow: `app/(public)/register/page.tsx` or similar
- Profile: `app/cleaner/profile/page.tsx`, `app/client/profile/page.tsx`, `app/admin/users/[id]/page.tsx`
- Property: `app/admin/properties/new/page.tsx`, `app/admin/properties/[id]/edit/page.tsx`
- Quote: `app/admin/quotes/new/page.tsx`, `app/quote/page.tsx` (public)
- Job: `app/admin/jobs/new/page.tsx`
- Lead form on public site

Replace existing free-text address fields with `<AddressAutocomplete>`. On submit, save normalized fields (lat/lng/placeId/suburb/state/postcode) to the model.

- [ ] One commit per surface.

## Task 6: Backfill script

**Files:** `scripts/backfill/geocode-addresses.ts`, `prisma/schema.prisma` (maybe new `GeocodeFailure` model)

- [ ] Reads all Property/User/Client rows with null `lat`. Calls `/api/geocode/lookup` (rate limited 50/sec) with the existing `address` string. On success, updates row. On failure, logs to `GeocodeFailure` (id, modelType, modelId, query, reason, occurredAt).
- [ ] Run once, idempotent — reruns skip already-geocoded rows.
- [ ] Test against seed data.

## Task 7: Full verification + push + PR
