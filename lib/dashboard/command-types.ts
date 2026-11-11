/**
 * Command page section payloads. Client-safe (no server imports).
 */
import type { EPillTone } from "@/components/v2/ui/pill";

export type CommandSectionKey = "tiles" | "queue" | "cleaners" | "money" | "glance";

export type CommandTile = {
  key: "unassigned" | "late" | "qa" | "invoices";
  label: string;
  /** Null when this figure could not be read; the tile then says so. */
  count: number | null;
  badge: { text: string; tone: EPillTone };
  href: string;
};

export type CommandTilesPayload = { tiles: CommandTile[] };

export type StripState = "done" | "on-site" | "late" | "planned" | "unassigned" | "travelling" | "not-started" | "off-site";

export type StripSegment = {
  jobId: string;
  /** Minutes after midnight (organisation timezone). */
  startMinute: number;
  endMinute: number;
  /** True when no end time or allocation was recorded and a default length is drawn. */
  lengthAssumed: boolean;
  state: StripState;
  label: string;
};

export type StripRow = { key: string; name: string; unassigned: boolean; segments: StripSegment[] };

export type TodayByCleanerPayload = {
  axisStartHour: number;
  axisEndHour: number;
  rows: StripRow[];
  /** Today's jobs with no start time: not drawable on a time axis. */
  withoutStartTime: number;
  nowMinute: number;
};

export type MoneyRow = { key: string; label: string; value: string; note?: string; badge?: { text: string; tone: EPillTone }; href: string };

export type MoneyPayload = { rows: MoneyRow[]; unavailable: string[] };

export type GlanceStatus = { status: string; label: string; count: number; href: string };

export type GlanceUpcoming = { id: string; propertyName: string; when: string; jobType: string; statusLabel: string };

export type GlanceFeedback = { id: string; jobId: string; clientName: string; rating: number | null; comment: string | null };

export type GlancePayload = {
  statuses: GlanceStatus[] | null;
  onShift: { travelling: number; onSite: number; clockedIn: number } | null;
  upcoming: GlanceUpcoming[] | null;
  feedback: GlanceFeedback[] | null;
  laundryDueToday: number | null;
  cleanersTomorrow: number | null;
  completedToday: number | null;
  todayKey: string;
};
