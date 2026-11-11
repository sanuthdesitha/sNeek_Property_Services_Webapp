/**
 * Shapes the Insights page reads from /api/admin/insights/*, with the light
 * guards the cancellable reader uses before trusting a body.
 */
import type { BusinessPayload } from "@/lib/insights/business";
import type { CleanerRow, ClientRow, PropertyRow } from "@/lib/insights/entities";
import type { EntityPage, TimeCostPayload } from "@/lib/insights/entity-service";
import type { InsightsAccess } from "@/lib/insights/types";
import { hasArray, isRecord } from "@/components/v2/admin/quality/hub/use-quality-read";

export type { BusinessPayload, CleanerRow, ClientRow, EntityPage, PropertyRow, TimeCostPayload };

export type InsightsOptions = { access: InsightsAccess; clients: Array<{ id: string; name: string }> };

export type InsightsContext = {
  access: InsightsAccess;
  canManageReports: boolean;
  timeZone: string;
};

export function isBusiness(body: unknown): body is BusinessPayload {
  return isRecord(body) && isRecord(body.cards) && isRecord(body.period) && hasArray(body, "findings") && isRecord(body.properties);
}

export function isEntityPage<T>(body: unknown): body is EntityPage<T> {
  return isRecord(body) && hasArray(body, "rows") && typeof body.total === "number" && isRecord(body.period);
}

export function isTimeCost(body: unknown): body is TimeCostPayload {
  return isRecord(body) && hasArray(body, "byJobType") && isRecord(body.byProperty) && isRecord(body.period);
}

export function isOptions(body: unknown): body is InsightsOptions {
  return isRecord(body) && hasArray(body, "clients") && isRecord(body.access);
}
