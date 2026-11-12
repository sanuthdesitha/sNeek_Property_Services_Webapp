-- Laundry "Ready to return" stage (2026-11-13). The laundry partner's team marks
-- a set that is washed and waiting to go back. Placed between PICKED_UP and
-- DROPPED. Additive only: no row changes status, and a run can still go
-- straight from PICKED_UP to DROPPED.
--
-- Its own migration on purpose: PostgreSQL does not allow a value added with
-- ALTER TYPE ... ADD VALUE to be used in the same transaction, so nothing in
-- this file (or any later statement of it) refers to the new value.
ALTER TYPE "LaundryStatus" ADD VALUE IF NOT EXISTS 'READY_TO_RETURN' AFTER 'PICKED_UP';
