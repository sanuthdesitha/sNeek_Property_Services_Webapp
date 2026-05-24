# Plan D Follow-up — Address Autocomplete Wire-In

Plan D landed `<AddressAutocomplete>` (new primitive) + extended the existing
`<GoogleAddressInput>` to capture `lat`/`lng`/`placeId`. Most production address
surfaces use `GoogleAddressInput` already, so the wire-in pass updated those
in place. This doc lists the surfaces that need a follow-up.

## Wired (capturing lat/lng/placeId)

- `components/admin/new-property-form.tsx` — property create
- `app/admin/properties/[id]/page.tsx` — property edit
- `components/admin/new-client-form.tsx` — client create
- `components/admin/edit-client-form.tsx` — client edit
- `components/admin/new-job-form.tsx` — job create (service-site path)
  - also: `lib/jobs/service-site.ts` persists lat/lng/placeId into the
    created `Property` row
- `components/quote/request-quote-page.tsx` — public quote / lead form
  - lat/lng/placeId go into `QuoteLead.structuredContext` JSON, since the
    schema doesn't yet have dedicated columns. Backfill or migrate later.

## Deferred (wired text-only; need lat/lng/placeId later)

- `components/admin/users-manager.tsx` — staff create + edit forms.
  Address ends up in `User.extendedProfile` JSON. To capture geo, decide whether
  to store on the User row (User has `latitude`/`longitude`/`placeId` columns
  already, just unused) or in the JSON blob.
- `app/onboarding/page.tsx` — staff onboarding wizard. Same story.

## Not yet visited

- `app/admin/quotes/new/page.tsx` (if it exists) — admin-side quote creation.
- Cleaner profile page (`app/cleaner/profile` → redirects to settings, which
  currently has no address field at all). When/if a home-address field is
  added, use `AddressAutocomplete` or `GoogleAddressInput` with the full
  `onResolved` payload.

## Schema notes

- `Property` already has `latitude` / `longitude` / `placeId`.
- `Client` already has `latitude` / `longitude` / `placeId`.
- `User` already has `latitude` / `longitude` / `placeId` (currently unused).
- `QuoteLead` does NOT have geo columns — using `structuredContext` JSON for now.

## Action items

1. Decide whether to migrate `QuoteLead` to first-class geo columns or keep
   the JSON blob.
2. Wire `users-manager.tsx` and `onboarding/page.tsx` once the User extended
   profile shape is finalised.
3. Once two-key Google Maps split lands (see `docs/ops/google-maps.md`),
   point the server-side proxy + backfill at `GOOGLE_MAPS_SERVER_KEY`.
