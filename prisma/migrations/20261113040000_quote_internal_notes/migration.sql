-- Office notes on a quote that the client never sees (owner decision
-- 2026-11-13). Nullable, no default and no backfill: every existing quote
-- simply has no office notes. The client-visible "notes" column is unchanged.
ALTER TABLE "Quote" ADD COLUMN "internalNotes" TEXT;
