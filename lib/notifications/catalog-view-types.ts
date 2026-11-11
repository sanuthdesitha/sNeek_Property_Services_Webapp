/** Shapes the notifications area receives from `/api/admin/notifications/catalog`. Client-safe. */
import type { NotificationTypeEntry } from "./catalog-types";

export type ResolvedSwitch = {
  id: string;
  label: string;
  /** null = no single on/off value (per-client or per-event; edited elsewhere). */
  enabled: boolean | null;
  editable: boolean;
  href: string | null;
  note: string | null;
};

export type CatalogTypeView = NotificationTypeEntry & {
  resolvedSwitches: ResolvedSwitch[];
  respectsPreferencesNow: boolean | null;
  disabledTransports: string[];
  externalPaths: Partial<Record<"EMAIL" | "SMS" | "WEB_PUSH", "pipeline" | "direct">>;
  templateHref: string | null;
};

export type CatalogResponse = { types: CatalogTypeView[]; controlsUpdatedAt: string | null };
