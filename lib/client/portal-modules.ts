import { isClientModuleEnabled } from "@/lib/portal-access";
import type { AppSettings } from "@/lib/settings";
import type { ClientNavModule } from "@/components/v2/client/portal/portal-nav";

type Visibility = AppSettings["clientPortalVisibility"];

/**
 * Which client-portal modules are switched on for this client, from the merged
 * per-client visibility (global settings + `portalVisibilityOverrides`).
 *
 * The same `isClientModuleEnabled` the page guards call, so a destination the
 * navigation offers is one its page will open. Only booleans about the client's
 * own portal leave the server; no record data.
 */
export function clientNavModules(visibility: Visibility): Record<ClientNavModule, boolean> {
  return {
    jobs: isClientModuleEnabled(visibility, "jobs"),
    calendar: isClientModuleEnabled(visibility, "calendar"),
    reports: isClientModuleEnabled(visibility, "reports"),
    laundry: isClientModuleEnabled(visibility, "laundry"),
    properties: isClientModuleEnabled(visibility, "properties"),
    inventory: isClientModuleEnabled(visibility, "inventory"),
    shopping: isClientModuleEnabled(visibility, "shopping"),
    stockRuns: isClientModuleEnabled(visibility, "stockRuns"),
    cases: isClientModuleEnabled(visibility, "cases"),
    finance: isClientModuleEnabled(visibility, "finance"),
    quoteRequests: isClientModuleEnabled(visibility, "quoteRequests"),
    approvals: isClientModuleEnabled(visibility, "approvals"),
    booking: isClientModuleEnabled(visibility, "booking"),
    taskRequests: visibility.showClientTaskRequests === true,
  };
}
