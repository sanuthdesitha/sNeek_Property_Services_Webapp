# Copy Guide

The voice and conventions every portal copy must follow. Marketing copy on the public site has more latitude.

## Voice

- **Clear.** One idea per sentence. Active voice. Subject-verb-object.
- **Concrete.** Specific nouns and verbs beat abstract jargon. "Send invoice" beats "Initiate billing process."
- **Kind.** Address the reader directly. Use "you" not "users." When something fails, take responsibility.
- **Calm.** No exclamation points except in error rebuttals ("Don't worry — it's saved!"). No "amazing," "incredible," "blazing fast."

## Banned phrases

Don't write these in portal UI:

- "Welcome to your dashboard"
- "Get started in seconds"
- "Powered by …"
- "Helpful tips"
- "Made with love"
- "Awesome"
- "Crushing it"
- "Click here"

## Page titles

- Imperative verbs or direct nouns. "Jobs", "Create Quote", "Today's Schedule".
- Title case (capitalize each meaningful word). No trailing punctuation.
- 2-4 words max.

## Section headings

- Sentence case ("Today's appointments" not "Today's Appointments").
- 5 words max.

## Buttons

- Imperative verbs only. "Save changes", "Send quote", "Mark complete", "Cancel".
- Never "OK", "Submit", "Click here", "Go".
- Destructive buttons get specific labels: "Delete client" not just "Delete".

## Empty states

One short sentence describing what would appear here, plus a CTA.

- ✅ "No jobs scheduled this week. Create one or check tomorrow."
- ❌ "Looks like you don't have any jobs yet — let's get you started!"

## Errors

Tell the user what happened and what they can do. Two parts:

- ✅ "Couldn't reach the server — check your connection and tap Retry."
- ❌ "An error occurred."

Never expose stack traces or raw error codes to end users. Log them; show a friendly version.

## Numerals

- Use digits, not words. "3 jobs", not "three jobs". Exception: starting a sentence — spell out or restructure.
- Money in finance contexts: `$1,250.00 AUD`. In dashboards/summaries: `$1,250` is fine.
- Percentages: `40%` (no space).

## Dates and times

- Always Sydney time unless the user is in another timezone (rare). Use IANA `Australia/Sydney`.
- Display short form in lists: `Tue 24 Nov`, `09:30`. Long form in detail views: `Tuesday 24 November 2026, 9:30 am`.
- Never ISO-8601 in UI: `2026-11-24T09:30:00+11:00` is for logs and APIs only.
- Relative time for recency: "3 min ago", "yesterday", "last Tuesday". Use absolute for >7 days.

## Status labels

Use the StatusPill variants per their semantic meaning:

- `success` — task completed, payment received, sync OK
- `warning` — at risk, needs attention but not failed
- `danger` — failed, breached, overdue
- `info` — informational, no action needed
- `primary` — branded "active" state
- `neutral` — default / inactive
- `accent` — featured / promotional
- `purple` — reserved for QA system contexts

## Confirmation dialogs

Pattern: short headline, one-sentence body, two buttons (cancel left, action right).

- Headline: "Delete this client?"
- Body: "This will also delete 4 properties and 12 historical jobs. This action can't be undone."
- Buttons: `Cancel` (ghost) / `Delete client` (destructive)

## Tooltips

- Single fragment, no terminal punctuation.
- 30 chars max ideally.
- ✅ "Cleaner not yet confirmed"
- ❌ "This is the cleaner that has been assigned to this job but they have not yet confirmed their availability."

## Loading states

- Don't write "Loading..."; show a skeleton from `<LoadingState>` instead.
- For very short waits, no message is fine.

## Notifications

- Subject line: actionable noun phrase. "New quote needs review", "Job scheduled for tomorrow".
- Body: 1-2 sentences. Link to the relevant record.
- Never use exclamation points.

---

**Enforcement:** every PR that adds user-visible copy should be reviewed against this guide. When in doubt, simpler and shorter wins.
