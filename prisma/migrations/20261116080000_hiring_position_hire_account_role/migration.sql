-- "Hires become" (board Hiring, 2026-11-16): the explicit account role a
-- person hired into this role receives. Nullable, no default and no backfill:
-- existing roles read "Not chosen" until someone picks one, so nothing is
-- guessed from a role title.
ALTER TABLE "HiringPosition" ADD COLUMN "hireAccountRole" "Role";
