/**
 * AUDIENCE-LEVEL outbound notification controls. Lets the owner silence a whole
 * audience (clients, cleaners, laundry, …) across a channel (email / SMS / push)
 * with global master switches over everything, independent of the per-EmailAutoKind
 * automation toggles (which stay applied in addition) and independent of any
 * per-user category preferences.
 *
 * No imports here on purpose — this is shared by lib/settings.ts and the send
 * chokepoints, so it must stay dependency-free to avoid import cycles (same rule
 * as email-kinds.ts).
 */
export const NOTIFICATION_AUDIENCES = [
  { key: "CLIENT", label: "Clients" },
  { key: "CLEANER", label: "Cleaners" },
  { key: "LAUNDRY", label: "Laundry team" },
  { key: "MAINTENANCE", label: "Maintenance" },
  { key: "QA", label: "QA inspectors" },
  { key: "STAFF_ADMIN", label: "Admin & ops staff" },
  { key: "PUBLIC", label: "Public / leads (no account)" },
] as const;

export type NotificationAudience = (typeof NOTIFICATION_AUDIENCES)[number]["key"];

export const NOTIFICATION_AUDIENCE_KEYS: NotificationAudience[] =
  NOTIFICATION_AUDIENCES.map((a) => a.key);

export interface AudienceChannelControls {
  email: boolean;
  sms: boolean;
  push: boolean;
}

export interface NotificationAudienceControls {
  /** Global masters — when a channel is off here, no audience receives it. */
  channels: { email: boolean; sms: boolean; push: boolean };
  /** Per-audience channel toggles. */
  audiences: Record<NotificationAudience, AudienceChannelControls>;
}

function allOnChannels(): AudienceChannelControls {
  return { email: true, sms: true, push: true };
}

function defaultAudienceMap(): Record<NotificationAudience, AudienceChannelControls> {
  return Object.fromEntries(
    NOTIFICATION_AUDIENCE_KEYS.map((k) => [k, allOnChannels()])
  ) as Record<NotificationAudience, AudienceChannelControls>;
}

/** Everything on by default; new audiences added later backfill to on. */
export const DEFAULT_NOTIFICATION_AUDIENCE_CONTROLS: NotificationAudienceControls = {
  channels: { email: true, sms: true, push: true },
  audiences: defaultAudienceMap(),
};

function sanitizeChannelControls(
  input: unknown,
  fallback: AudienceChannelControls
): AudienceChannelControls {
  const row = input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
  return {
    email: typeof row.email === "boolean" ? row.email : fallback.email,
    sms: typeof row.sms === "boolean" ? row.sms : fallback.sms,
    push: typeof row.push === "boolean" ? row.push : fallback.push,
  };
}

export function sanitizeNotificationAudienceControls(
  input: unknown
): NotificationAudienceControls {
  const row = input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};

  const channels = sanitizeChannelControls(
    row.channels,
    DEFAULT_NOTIFICATION_AUDIENCE_CONTROLS.channels
  );

  const audiencesIn = row.audiences && typeof row.audiences === "object" && !Array.isArray(row.audiences)
    ? (row.audiences as Record<string, unknown>)
    : {};
  // Start from defaults (all on) so newly-added audiences are enabled, then
  // apply any explicit booleans the owner saved for known audiences.
  const audiences = defaultAudienceMap();
  for (const key of NOTIFICATION_AUDIENCE_KEYS) {
    audiences[key] = sanitizeChannelControls(audiencesIn[key], audiences[key]);
  }

  return { channels, audiences };
}

/**
 * Map a user role to the audience it belongs to. Anything unknown / null (e.g.
 * a lead or contact with no account) maps to PUBLIC.
 */
export function audienceForRole(role: string | null | undefined): NotificationAudience {
  switch (role) {
    case "CLIENT":
      return "CLIENT";
    case "CLEANER":
      return "CLEANER";
    case "LAUNDRY":
      return "LAUNDRY";
    case "MAINTENANCE":
      return "MAINTENANCE";
    case "QA_INSPECTOR":
      return "QA";
    case "ADMIN":
    case "OPS_MANAGER":
      return "STAFF_ADMIN";
    default:
      return "PUBLIC";
  }
}

/**
 * True when a channel is allowed to reach an audience right now. Undefined
 * controls → allowed (fail-open, matches the isAutoEmailAllowed precedent).
 * A global master off beats an audience toggle on; an audience toggle off
 * blocks even when the master is on.
 */
export function isChannelAllowed(
  controls: NotificationAudienceControls | undefined,
  audience: NotificationAudience,
  channel: "email" | "sms" | "push"
): boolean {
  if (!controls) return true;
  if (controls.channels?.[channel] === false) return false;
  const audienceControls = controls.audiences?.[audience];
  if (!audienceControls) return true;
  return audienceControls[channel] !== false;
}
