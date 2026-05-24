# Email Operations

Production sender: `Resend` via `RESEND_API_KEY`. Default `From` header is set by
`lib/notifications/email.ts` from `process.env.EMAIL_FROM`, falling back to
`admin@sneekproservices.com.au`. The sending domain is therefore
`sneekproservices.com.au` unless explicitly overridden per-send.

## DNS records to maintain

These must be in your DNS provider (currently the domain registrar):

### SPF (TXT record on the apex `sneekproservices.com.au`)

```
v=spf1 include:_spf.resend.com -all
```

### DKIM (TXT/CNAME records per Resend domain config)

Resend issues CNAME records pointed at `resend.com` infrastructure. Add them
exactly as the Resend dashboard shows. Three CNAMEs are typical:

- `resend._domainkey.sneekproservices.com.au` → resend-generated value
- `_resend.send.sneekproservices.com.au` → resend-generated value
- `_resend.api.sneekproservices.com.au` → resend-generated value

### DMARC (TXT record on `_dmarc.sneekproservices.com.au`)

```
v=DMARC1; p=quarantine; rua=mailto:dmarc@sneekproservices.com.au; pct=100
```

Start with `p=none` for monitoring; tighten to `quarantine` then `reject` once
mail flow is verified clean.

## 30-day stats process

The admin dashboard at `/admin/system/email` shows a rolling 30-day delivery
funnel computed from the `NotificationLog` table (grouped by `status`). For
provider-side metrics (open rates, bounce rates, top failures), pull from the
[Resend dashboard](https://resend.com/emails) manually — Resend does not yet
expose these via API.

Cadence:

- **Weekly**: glance at funnel on `/admin/system/email`. If `FAILED` > 5% of
  `SENT`, investigate.
- **Monthly**: pull 30-day stats from Resend dashboard, archive a screenshot in
  ops notes.

## Suppression policy

- **Hard bounce** (recipient address does not exist or domain dead): auto-
  suppress immediately. `User.emailStatus = HARD_BOUNCE`. Non-transactional
  sends blocked.
- **Complaint** (recipient marked as spam): auto-suppress immediately.
  `User.emailStatus = COMPLAINT`.
- **Soft bounce** (mailbox full, temporary issue): increment counter. After 3
  within 7 days → `SOFT_BOUNCE`. (Initial implementation logs soft bounces;
  count-based escalation is a planned follow-up.)
- **Unsubscribe**: user explicitly unsubscribed via list-unsubscribe header.
  `User.emailStatus = UNSUBSCRIBED`.

Transactional categories (`password-reset`, `otp`, `invoice-ready`) bypass
suppression but record every attempt to `NotificationLog`. The send path
distinguishes them via the `transactional: true` flag in `sendEmail()`.

## Webhook

Resend webhook: `POST https://sneekholdings.com/api/integrations/resend/webhook`

Signing secret stored in `.env` as `RESEND_WEBHOOK_SIGNING_SECRET`
(Resend-issued, format `whsec_...`). The handler at
`app/api/integrations/resend/webhook/route.ts` verifies signatures via the SVIX
library before processing.

Events handled:

- `email.bounced` → suppress per policy above (hard bounce only at first; soft
  bounce logged for future cumulative count)
- `email.complained` → suppress with reason `COMPLAINT`
- `email.delivered` → no-op (just logged)
- `email.opened` → no-op (just logged)
- `email.sent` → no-op (just logged)
- `email.delivery_delayed` → no-op (one-time soft bounce; suppression policy
  uses cumulative count)

## Manual unsuppress

Admins and ops managers can clear a suppression from `/admin/system/email`.
Click "Unsuppress" next to any row; the user's `emailStatus` returns to `OK`
and non-transactional sends resume.
