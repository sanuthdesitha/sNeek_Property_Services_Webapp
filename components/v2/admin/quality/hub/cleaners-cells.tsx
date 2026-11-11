/**
 * Cell renderers for the Cleaners table, matching the concept: severity
 * pills, "None" in muted text, the streak with "bonus due", and "–" with a
 * reason wherever a figure has no data behind it.
 */
import { EPill, type EPillTone } from "@/components/v2/ui/pill";
import type { SeverityCounts } from "@/lib/quality/groupings";
import { severityCountLabel } from "@/lib/quality/severity";
import type { CleanerRow } from "./hub-types";

const MUTED = "text-[hsl(var(--e-muted-foreground))]";

export function NoneText({ children = "None" }: { children?: string }) {
  return <span className={MUTED}>{children}</span>;
}

const SEVERITY_PILLS: ReadonlyArray<{ severity: keyof SeverityCounts; tone: EPillTone }> = [
  { severity: "MINOR", tone: "neutral" },
  { severity: "MAJOR", tone: "warn" },
  { severity: "CRITICAL", tone: "bad" },
];

/** "2 low · 1 med · 1 high" pills (labels from lib/quality/severity); nothing for a zero count. */
export function SeverityCountPills({ counts }: { counts: SeverityCounts }) {
  return (
    <span className="flex flex-wrap gap-1">
      {SEVERITY_PILLS.map(({ severity, tone }) =>
        counts[severity] > 0 ? (
          <EPill key={severity} tone={tone}>
            {severityCountLabel(counts[severity], severity)}
          </EPill>
        ) : null,
      )}
    </span>
  );
}

export function IssueSeverityPills({ row }: { row: CleanerRow }) {
  if (row.issues.total === 0) return <NoneText />;
  return <SeverityCountPills counts={row.issues.bySeverity} />;
}

export function OpenFixesCell({ row }: { row: CleanerRow }) {
  return row.openFixes > 0 ? <EPill tone="warn">{`${row.openFixes} open`}</EPill> : <NoneText />;
}

export function FalseConfirmationCell({ row }: { row: CleanerRow }) {
  const { suspected, confirmed } = row.falseConfirmations;
  if (suspected === 0 && confirmed === 0) return <NoneText />;
  return (
    <span className="flex flex-wrap gap-1">
      {suspected > 0 ? <EPill tone="bad">{`${suspected} suspected`}</EPill> : null}
      {confirmed > 0 ? <EPill>{`${confirmed} confirmed`}</EPill> : null}
    </span>
  );
}

export function StreakCell({ row }: { row: CleanerRow }) {
  const streak = row.streak;
  if (!streak) return <span className={MUTED} title="The streak could not be read">–</span>;
  if (streak.sample === 0) return <NoneText>No reviewed cleans</NoneText>;
  const label = streak.currentStreak === 0 ? "Reset" : `${streak.currentStreak} clean`;
  const last5 = streak.last5Avg === null ? "–" : Math.round(streak.last5Avg);
  const title = `Current streak of qualifying cleans. Last 5 average ${last5}.`;
  // "bonus due" is the automatic streak / ranking rule only; a bonus proposed
  // by hand does not make a streak "due".
  if (row.pendingBonuses.some((bonus) => bonus.origin === "automatic")) return <EPill tone="gold">{`${label} · bonus due`}</EPill>;
  return (
    <span title={title} className={streak.currentStreak === 0 ? MUTED : undefined}>
      {label}
    </span>
  );
}

export function ScoreCell({ row }: { row: CleanerRow }) {
  if (row.avgScore === null) return <span className={MUTED} title="No reviewed cleans in this period">–</span>;
  return <b className="e-tnum">{Math.round(row.avgScore)}</b>;
}
