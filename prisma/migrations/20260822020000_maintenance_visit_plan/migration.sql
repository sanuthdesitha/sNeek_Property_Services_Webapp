-- The visit, as the client or their assistant described it.
--
-- `scheduledFor` already held a timestamp, but a timestamp is not a visit: it
-- says nothing about who is coming, how they get in, how long they will be, or
-- whether the clean can go ahead around them — and every one of those questions
-- lands on the CLEANER rather than on the maintenance item.
--
-- JSONB rather than a dozen columns, for the same reason the job meta is one
-- blob: the set of questions worth asking will grow as the business learns what
-- it needs, and each new one would otherwise be a migration against a live
-- table. Validated on the way in and on the way out by
-- lib/maintenance/visit-plan — Json in the database does not mean unvalidated
-- in the application.
--
-- Deliberately carries NO cost field. A VA must never commit spend, and a cost
-- box on their screen invites exactly that.

ALTER TABLE "PropertyMaintenanceItem" ADD COLUMN "visitPlan" JSONB;
