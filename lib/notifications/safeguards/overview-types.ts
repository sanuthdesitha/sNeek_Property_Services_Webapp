/**
 * Shapes of the Sending safeguards screen's data, shared by the server
 * builder, the route and the client screen. No server imports.
 */
import type { SafeguardSettings } from "./config";

export type SafeguardIncidentView = {
  id: string;
  kind: string;
  scopeKind: string;
  scopeLabel: string;
  label: string;
  status: string;
  pausesSending: boolean;
  attempts: number;
  recipients: string[];
  transport: string | null;
  windowMinutes: number | null;
  threshold: number | null;
  note: string | null;
  createdAt: string;
  resolvedAt: string | null;
  alertedAt: string | null;
  resolutionNote: string | null;
};

export type SafeguardVolumeRow = { typeKey: string; typeName: string; transport: string; sent: number; notSent: number; held: number };

export type SafeguardsOverview = {
  generatedAt: string;
  timeZone: string;
  /** Start of the organisation's day the volumes count from. */
  since: string;
  settings: SafeguardSettings;
  volumes: SafeguardVolumeRow[];
  topRecipients: Array<{ recipient: string; transport: string; sent: number }>;
  suppressedByReason: Array<{ reason: string; label: string; count: number }>;
  recentNotSent: Array<{ id: string; createdAt: string; transport: string; typeName: string; recipient: string; reason: string; label: string; held: boolean; subject: string | null }>;
  paused: SafeguardIncidentView[];
  incidents: SafeguardIncidentView[];
  pausableTypes: Array<{ key: string; name: string }>;
};

/** The route adds what the viewer may do. */
export type SafeguardsResponse = SafeguardsOverview & {
  canManage: boolean;
  /** Why the viewer cannot change anything, when they cannot. */
  readOnlyReason: string | null;
};
