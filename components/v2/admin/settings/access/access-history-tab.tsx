"use client";

import type { AccessHistoryEntry } from "@/lib/rbac/access-screen-types";
import { formatWhen } from "./access-labels";

/** Every saved access change, newest first, in the organisation's timezone. */
export function AccessHistoryTab({
  history,
  names,
  presetNames,
  timeZone,
}: {
  history: AccessHistoryEntry[];
  names: Record<string, string>;
  presetNames: Record<string, string>;
  timeZone: string;
}) {
  const subject = (id: string) => (id.startsWith("preset:") ? `Preset ${presetNames[id.slice(7)] ?? "removed"}` : names[id] ?? "Former staff member");
  return (
    <section aria-labelledby="access-history-title" className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="access-history-title" className="text-[1rem] font-[600]">History</h2>
        <a className="text-[0.8125rem] underline" href="/v2/admin/activity">Activity log</a>
      </div>
      {history.length === 0 ? (
        <p className="mt-2 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No access changes have been saved on this screen yet.</p>
      ) : (
        <ol className="mt-2 list-none divide-y divide-[hsl(var(--e-border))] p-0 text-[0.8125rem]">
          {history.map((entry) => (
            <li key={entry.id} className="py-2">
              <b>{formatWhen(entry.at, timeZone)}</b> · {entry.actorName} · {subject(entry.subjectId)}
              <span className="block text-[hsl(var(--e-muted-foreground))]">{entry.text}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
