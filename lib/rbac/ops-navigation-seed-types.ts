import type { OpsLevels } from "./ops-catalog";

/**
 * The navigation answer the server resolved while rendering a page, handed to
 * the browser's OpsAccessProvider so the rail does not start empty. `levels`
 * null means no pack applies (administrators and non-managers).
 */
export type OpsNavigationSeed = {
  userId: string;
  /** The account's primary role, so admin-only entries stay hidden from others while the browser session loads. */
  role: string;
  levels: OpsLevels | null;
};
