/**
 * Live ops views. Kept in a plain module (no "use client") because the server
 * page validates the `?view=` parameter against this list; a value exported
 * from a client module cannot be read on the server.
 */
export type LiveView = "exceptions" | "onsite" | "travelling" | "notstarted";
export const LIVE_VIEWS: LiveView[] = ["exceptions", "onsite", "travelling", "notstarted"];
