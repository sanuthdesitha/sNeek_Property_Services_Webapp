/**
 * The Test as session limit, in a plain module so client components (the
 * confirmation's "It ends by itself at …") can read it without pulling in the
 * ticket crypto. `lib/auth/impersonation.ts` re-exports it unchanged.
 *
 * Deliberately short. This is a testing tool, not a way to work as someone
 * else all day. Owner default, pending owner confirmation (board "Test as",
 * 2026-11-17): keep one hour.
 */
export const IMPERSONATION_MAX_AGE_SECONDS = 60 * 60; // 1 hour
