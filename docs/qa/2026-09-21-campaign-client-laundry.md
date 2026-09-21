# Campaign and client/laundry fixes — 2026-09-21

## Delivered behavior

- Both campaign senders resolve per-client variables. HTML values are escaped; invalid variables prevent delivery. Tests cover all 12 built-in templates.
- One-recipient audiences target an exact existing client/contact email and cannot fall back to a broadcast. Preview and partial campaign updates validate the audience. Secondary contacts without a phone cannot redirect SMS to the owner.
- Test-send resolves a selected client's details but sends only to the signed-in admin. Failed/partial delivery has truthful status and counts; one failed scheduled campaign does not block later campaigns.
- Client Jobs defaults to the Sydney day unless an explicit saved selection exists. Today resets stale date bounds and selects the current day/month.
- Client Laundry supports property/status/date-type filters, day navigation and historical custom dates, compact expandable details, permission-gated photos, and readable notes/bag counts. Server filtering retains client/VA scope; the 200-result limit is disclosed. Initial and subsequent read failures have retry states.
- Driver Laundry constrains narrow grids, wraps actions, provides mobile history cards and usable correction dialogs, and increases phone control targets.

## Verification

- Focused campaign/email/client/laundry suite: 285 tests in 39 files passed. Four further campaign UI failure-result tests passed in the 11-test component suite.
- Driver laundry: 28 synthetic browser scenarios passed at 320, 390, 768 and 1440px, including correction/access dialogs, navigation, empty/error states.
- Client laundry: three styled browser scenarios passed at 320, 390 and 1440px. Phone and desktop screenshots were inspected.
- Client Jobs/calendar: seven tests also passed with the process timezone set to America/Los_Angeles at a Sydney month boundary.
- Focused coverage: new audience/render helpers have 100% line/function coverage; branch coverage is 85%/83.33%. Existing generic variable resolver has 81.54% line coverage in this focused suite. This is not a claim of repository-wide 95% coverage.
- Providers and database reads were mocked or synthetic. No real email/SMS was sent or production record mutated.

- TypeScript `tsc --noEmit` passed. Production build passed (714/714 static pages, exit 0). The initial run timed out during page generation; retry used a 40-minute local ceiling and a one-second loopback database connection timeout, completing in 498 seconds. Blog/sitemap reads used their existing unavailable-database fallback.

## Outstanding clarification

Admin laundry QR generation is pending clarification of the user's phrase "not to generate". Existing scanners read laundry task IDs, and there is no persistent individual-bag model. A permanent per-property/per-bag label requires a compatible scanner resolution contract; task labels alone would not distinguish reusable bags.
