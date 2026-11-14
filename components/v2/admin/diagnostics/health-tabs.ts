/**
 * System health tabs. Plain module (no "use client"): the server page reads
 * the tab from the URL with it.
 */
export type HealthTab = "overview" | "scheduled" | "email" | "uploads" | "server";

export function resolveHealthTab(value: string | undefined): HealthTab {
  if (value === "scheduled" || value === "email" || value === "uploads" || value === "server") return value;
  // The earlier Diagnostics "System" tab is the Server tab now.
  if (value === "system") return "server";
  return "overview";
}
