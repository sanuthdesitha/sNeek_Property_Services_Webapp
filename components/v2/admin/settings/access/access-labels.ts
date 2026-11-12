/** Display helpers for the access screen (plain module). */
import { OPS_FEATURES, type OpsFeature } from "@/lib/rbac/ops-catalog";

export const GROUP_ORDER = ["Overview", "Operations", "People & properties", "Money", "Communications", "Configuration"] as const;

/** The board writes "and" where the catalog has "&". */
export function plainLabel(label: string): string {
  return label.replace(/ & /g, " and ");
}

export function areaLabel(area: OpsFeature): string {
  return plainLabel(OPS_FEATURES.find((feature) => feature.key === area)?.label ?? area);
}

export function initials(name: string | null, email: string | null): string {
  const source = (name || email || "?").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function displayName(person: { name: string | null; email: string | null }): string {
  return person.name || person.email || "Unnamed account";
}

export function firstName(person: { name: string | null; email: string | null }): string {
  return displayName(person).split(/\s+/)[0];
}

export function formatWhen(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

export function formatDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone, day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}
