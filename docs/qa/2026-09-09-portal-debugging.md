# Portal Debugging and Browser QA - 2026-09-09

Environment: local Next.js v2 on http://localhost:3010. Web scheduler disabled.
The owner confirmed the local app does not use live business data. Dedicated
QA client, cleaner, VA, two properties and one job were created for testing;
existing accounts and jobs were not overwritten. The QA job was paused after
the test. No deployment or schema migration was performed.

## Changes

- Cleaner video evidence is compressed before upload using a lazily loaded
  Mediabunny converter. Input is read from a File; compressed output uses private
  browser storage when available. The longest video dimension is capped at 1280px
  with aspect ratio preserved. Audio is retained; conversions that drop tracks
  fail explicitly. If compression is larger than the source, the source is kept.
- Cleaner videos use multipart storage without the direct endpoint's video-size
  ceiling. Compression progress, cancellation, retry and temporary-file cleanup
  are integrated into the existing form media pipeline.
- Multipart setup/completion now use settings-aware storage credentials. Part
  retries, missing-receipt detection and abort cleanup were added. A same-origin
  streaming part route handles environments that cannot PUT directly to storage.
  Completion, cancellation and streamed parts check upload ownership.
- Cleaner calendar loads and displays early check-in / late checkout metadata
  in selected-day and agenda rows. Offer actions use the cleaner's assignment
  response. The month toolbar wraps on small screens.
- Client home uses readable service/status labels, counts actionable items
  rather than informational scheduled work, removes obsolete preview copy, and
  labels pending unbilled work accurately instead of calling it a balance due.
- VA home applies permission gates and property scope to overview queries and
  actions. Scoped finance filters property rates/work and excludes invoices
  containing lines outside the permitted properties.
- Team permission/property edits are serialized. Added team rename, explicit
  all-property selection, a safeguard against accidentally widening scope by
  removing the last property, and inactive/expired invitation states.
- VA navigation to the client-only team page now redirects instead of throwing.
  The typed removal confirmation input now has an accessible name.

## Executed Workflows

| Workflow | Result |
| --- | --- |
| Local cleaner, client and VA sign-in | Passed with dedicated QA accounts |
| Cleaner calendar month/agenda and job link | Passed; timing tags visible at desktop and 375px |
| Cleaner GPS check-in, timing briefing, start and pause | Passed; job left paused |
| 1080p video with audio, browser compression | 13,174,257 bytes to 785,291 bytes |
| Local compressed output decode | Passed; 1280x720, 30fps, full 4-second duration, AAC audio |
| Large video compression | 197,591,445 bytes to 11,718,654 bytes |
| Actual cleaner form video uploads | Both sizes completed; large result uploaded in three parts |
| Compression cancellation | Passed |
| Failed upload cleanup and retry | Exercised before adding streaming fallback; cleanup returned success |
| Client booking wizard | Property/date/confirmation steps passed; final booking was not sent |
| Team create, rename, permission save and reload | Passed |
| Explicit all-property toggle and restricted selection | Passed; restriction restored |
| Removing the final selected property | Refused without silently granting all properties |
| Temporary team removal with typed confirmation | Passed |
| VA restricted home/property listing | Ungranted second property absent |
| VA client-only team URL | Redirected to VA home |

## Navigation and Visual Coverage

Client routes visited through navigation: home, jobs, laundry, approvals, reports,
calendar, booking, properties, inventory, shopping, stock runs, cases, maintenance,
messages, finance, quotes, request quote, referrals, profile, assistants, settings.
Referrals initially timed out on cold navigation and passed when revisited.

Cleaner routes visited: today, jobs, calendar, job workspace, route, pay, supplies,
QA feedback, lost and found, invoices, pay requests, availability, team hub,
profile and settings.

VA routes visited: home, jobs, laundry, reports, calendar, booking, properties,
inventory, cases, maintenance and messages; client-only team access also checked.

Screenshots were inspected for the changed calendar, form and team controls on
desktop/mobile, and for supporting portal pages. Screens initially captured while
loading were revisited for settled-state checks. Navigation checks are not proof
that every feature or every state on each page has been executed.

Local screenshots: C:/Users/User/AppData/Local/Temp/sneek-portal-qa/

## Automated Checks

- TypeScript: `npx tsc --noEmit --pretty false` passed.
- 69 tests passed across upload pipeline, multipart recovery, scoped finance,
  client scope, VA permissions, VA team services and team controls.
- `git diff --check` passed (existing line-ending warnings only).
- Targeted lint could not run: `next lint` opened the initial ESLint setup prompt.
  No lint configuration was added as part of these fixes.

## Limits and Follow-up

- This is not an all-features sign-off. Payment execution, outbound invitations,
  emails, final booking submission, final job submission/report generation and
  every populated-data branch were not executed in this walkthrough.
- The test browser rejected remote video playback with a URL-safety error.
  Storage upload completion passed, and the local compressed file decoded
  correctly. Remote playback still needs verification in a normal allowed browser.
- Browser codec support and available device memory/storage remain practical
  limits; "any size" cannot mean infinite files or every codec on every phone.
  iOS Safari and physical Android capture have not been tested.
- No production build or deployment was performed. The existing unrelated
  worktree edits were preserved.

Converter reference: https://mediabunny.dev/guide/converting-media-files
