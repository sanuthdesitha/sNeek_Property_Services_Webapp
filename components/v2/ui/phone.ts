/**
 * Phone layout constants shared by the Estate primitives (board "Admin phone",
 * 2026-11). Plain module: server pages, client components and tests read it.
 * Never add "use client" here (tests/lib/server-client-value-imports.test.ts).
 *
 * Phone means below 640px: Tailwind `max-sm:` for phone-only styles and `sm:`
 * for everything from 640px up, which must look and behave exactly as before.
 */

/** The media query that matches a phone. Mirrors Tailwind's `max-sm:`. */
export const PHONE_QUERY = "(max-width: 639.98px)";

/**
 * Docked phone bars (bulk bar, page action bar) sit just above the portal's
 * bottom tab bar (48px links plus a hairline) and the device's safe area.
 */
export const PHONE_DOCK_CLASS =
  "max-sm:fixed max-sm:inset-x-2 max-sm:bottom-[calc(env(safe-area-inset-bottom)+3.5rem)] max-sm:z-40";

/** Container of a centred dialog that becomes a bottom sheet on a phone. */
export const PHONE_SHEET_CONTAINER_CLASS = "max-sm:items-end max-sm:overflow-hidden max-sm:p-0";

/** Panel of a centred dialog that becomes a bottom sheet on a phone. */
export const PHONE_SHEET_PANEL_CLASS =
  "max-sm:my-0 max-sm:max-h-[92dvh] max-sm:max-w-none max-sm:overflow-y-auto max-sm:overscroll-contain " +
  "max-sm:rounded-b-none max-sm:rounded-t-[18px] max-sm:pb-[env(safe-area-inset-bottom)]";

/** The grab handle drawn at the top of a bottom sheet (decorative). */
export const PHONE_SHEET_GRAB_CLASS = "mx-auto mt-2 block h-1 w-10 rounded-full bg-[hsl(var(--e-border-strong))] sm:hidden";
