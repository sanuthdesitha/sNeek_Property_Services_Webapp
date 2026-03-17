# Deployment Readiness Checklist

Use this before production deployment.

## Environment
- `APP_URL` points to your real domain (not localhost).
- `NEXTAUTH_SECRET` is set and strong.
- `DATABASE_URL` points to production database.
- Email env set (`RESEND_API_KEY`, `EMAIL_FROM`, verified domain).
- S3 env set (`S3_BUCKET_NAME`, keys, endpoint/region if needed).

## Predeploy automation
Run:

```bash
npm run predeploy:check -- --with-build
```

This verifies:
- Required environment variables
- DB connectivity
- Presence of `pg_dump`/`tar`
- Production build
- Generates `predeploy-button-report.json` with potential non-wired buttons to manually review

## Data safety
1. Create full backup:
   - `npm run backup:create`
2. Confirm:
   - backup folder exists
   - archive exists
   - `manifest.json` has expected model counts
3. Keep backup artifact outside the app server (offsite bucket or secure storage)

## Release flow
1. Backup
2. Deploy
3. Run smoke checks (login, create job, submit cleaner form, laundry update, quote create, report download)
4. Monitor notifications/email logs and worker logs

