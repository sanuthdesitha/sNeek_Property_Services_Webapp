# Backup and Recovery Runbook

This project now includes backup tooling for:
- PostgreSQL data
- Logical JSON export of all Prisma models
- Upload/media objects from your S3 bucket
- Optional offsite archive upload

## 1) Environment prerequisites

Required:
- `DATABASE_URL`
- `S3_BUCKET_NAME` (for media backups)
- S3 credentials (`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, optionally `S3_ENDPOINT`, `S3_REGION`)

Recommended:
- Install PostgreSQL client tools (`pg_dump`, `pg_restore`) on the deployment host.
- Set `BACKUP_S3_BUCKET` for offsite archive copy.

## 2) Create a full backup

Run:

```bash
npm run backup:create
```

This runs `scripts/backup/create-backup.ts` and creates:
- `backups/backup-YYYYMMDD-HHMMSS/`
- `database.dump` if `pg_dump` is available
- `database-json/*.json` always
- `uploads/` if `--include-uploads` is enabled and S3 is configured
- `manifest.json` with counts and warnings
- `backup-YYYYMMDD-HHMMSS.tar.gz` archive if `tar` is available

To upload archive offsite:

```bash
tsx scripts/backup/create-backup.ts --include-uploads --upload-offsite
```

## 3) Restore from backup

Restore DB dump (destructive, uses `--clean --if-exists`):

```bash
tsx scripts/backup/restore-backup.ts --backup-dir=backups/backup-YYYYMMDD-HHMMSS --confirm
```

Restore uploads to S3 as well:

```bash
tsx scripts/backup/restore-backup.ts --backup-dir=backups/backup-YYYYMMDD-HHMMSS --confirm --restore-uploads
```

## 4) Zero-loss upgrade process

Before every migration/release:
1. Put app into maintenance mode (or freeze writes).
2. Run backup (`npm run backup:create`).
3. Verify archive and manifest were created.
4. Apply migrations/deploy.
5. Run smoke checks.
6. Keep at least 7 daily + 4 weekly + 12 monthly backups.

## 5) Scheduling recommendation

- Run backup daily via cron/task scheduler.
- Run an extra backup before every deploy.
- Test restore monthly on a staging environment.

