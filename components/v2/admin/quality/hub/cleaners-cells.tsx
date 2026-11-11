/**
 * Cell renderers for the Cleaners table, matching the concept: severity
 * pills, "None" in muted text, the streak with "bonus due", and "–" with a
 * reason wherever a figure has no data behind it.
 */
import { EPill } from "@/components/v2/ui/pill";
import type { CleanerRow } from "./hub-types";

const MUTED = "text-[hsl(var(--e-muted-foreground))]";

export function NoneText({ children = "None" }: { children?: string }) {
  return <span className={MUTED}>{children}</span>;
}

export function IssueSeverityPills({ row }: { row: CleanerRow }) {
  const { MINOR, MAJOR, CRITICAL } = row.issues.bySeverity;
  if (row.issues.total === 0) return <NoneText />;
  return (
    <span className="flex flex-wrap gap-1">
      {MINOR > 0 ? <EPill>{`${MINOR} minor`}</EPill> : null}
      {MAJOR > 0 ? <EPill tone="warn">{`${MAJOR} major`}</EPill> : null}
      {CRITICAL > 0 ? <EPill tone="bad">{`${CRITICAL} critical`}</EPill> : null}
    </span>
  );
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
  if (row.pendingBonuses.length > 0) return <EPill tone="gold">{`${label} · bonus due`}</EPill>;
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
