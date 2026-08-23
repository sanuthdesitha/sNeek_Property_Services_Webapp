import { cookies } from "next/headers";

/**
 * WHICH HAT SOMEBODY IS CURRENTLY WEARING.
 *
 * A person who both cleans and inspects needs to be in one portal at a time.
 * This cookie records which — nothing more.
 *
 * IT IS NOT A GRANT, AND IT IS NEVER TRUSTED AS ONE. It carries a role NAME and
 * no authority whatsoever: `resolveActiveRole` checks it against the roles the
 * database says the person holds, on every single request, and falls back to
 * their primary role when it does not match. Editing this cookie by hand gets
 * you your own primary portal, which is where you already were.
 *
 * THAT IS WHY IT IS NOT SIGNED, and the contrast with `sneek.test-as` is worth
 * stating. The impersonation ticket IS authority — it names a different user to
 * become — so it is a signed JWE that has to be unforgeable. This one names a
 * role its holder must independently be proven to have, so signing it would
 * protect nothing and would imply a trust the code deliberately does not extend.
 *
 * NOT httpOnly, deliberately: the switcher is a client component and reads this
 * to show which hat is active. There is nothing here worth hiding — the value is
 * one of the user's own roles, which the UI already displays.
 */

export const ACTIVE_ROLE_COOKIE = "sneek.active-role";

/**
 * A year. The switch is a preference, not a session: somebody who mostly cleans
 * but inspects on Fridays should not be dropped back into the wrong portal
 * because a week went by.
 */
const MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/**
 * Read the requested role, if any.
 *
 * Returns the raw string rather than a `Role`, because narrowing it to the enum
 * here would imply the value has been checked — and it has not. Only
 * `resolveActiveRole`, holding the list of roles the person actually has, can
 * decide whether it means anything.
 *
 * Never throws. A missing or malformed cookie means "no preference", which
 * resolves to the primary role.
 */
export function readActiveRoleCookie(): string | null {
  try {
    return cookies().get(ACTIVE_ROLE_COOKIE)?.value?.trim() || null;
  } catch {
    // `cookies()` throws outside a request scope. Treated as no preference
    // rather than propagated: a role switcher must never be able to take down
    // the thing it is decorating.
    return null;
  }
}

/** Cookie options shared by the set and clear paths, so the two cannot drift. */
export function activeRoleCookieOptions(): {
  httpOnly: boolean;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  };
}
