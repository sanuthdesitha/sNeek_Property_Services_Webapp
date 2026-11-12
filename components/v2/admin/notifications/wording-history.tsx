"use client";

import * as React from "react";
import { formatInTimeZone } from "date-fns-tz";
import { EPill } from "@/components/v2/ui/pill";
import { EButton } from "@/components/v2/ui/primitives";
import { FIELD_LABEL, WORDING_TRANSPORT_LABEL } from "@/lib/notifications/wording/types";
import type { WordingPartView, WordingVersionView } from "@/lib/notifications/wording/view-types";

type Props = {
  part: WordingPartView;
  timeZone: string;
  canRestore: boolean;
  busy: boolean;
  onRestore: (version: number) => void;
};

function savedLabel(version: WordingVersionView, timeZone: string): string {
  if (!version.savedAt) return "Default";
  const date = new Date(version.savedAt);
  return Number.isFinite(date.getTime()) ? formatInTimeZone(date, timeZone, "d MMM yyyy, HH:mm") : "Unknown time";
}

/** Version history of one part on one transport: compare with the live wording and restore. */
export function WordingHistory({ part, timeZone, canRestore, busy, onRestore }: Props) {
  const [showAll, setShowAll] = React.useState(false);
  const [compare, setCompare] = React.useState<number | null>(null);
  const newestFirst = [...part.versions].reverse();
  const visible = showAll ? newestFirst : newestFirst.slice(0, 3);
  const compared = part.versions.find((version) => version.version === compare) ?? null;
  const liveVersion = part.liveVersion;

  return (
    <section aria-labelledby="wording-history-heading" className="overflow-hidden rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
      <div className="flex flex-wrap items-center justify-between gap-2 p-4 pb-2">
        <h3 id="wording-history-heading" className="font-semibold">Version history · {WORDING_TRANSPORT_LABEL[part.transport]}</h3>
        {newestFirst.length > 3 ? (
          <EButton size="sm" variant="ghost" onClick={() => setShowAll((value) => !value)} aria-expanded={showAll}>{showAll ? "Show fewer" : `Show all ${newestFirst.length}`}</EButton>
        ) : null}
      </div>
      {part.liveSource === "forms" ? <p className="px-4 pb-2 text-xs">The live wording was changed in Forms after the last version saved here. Saving here records it as a new version.</p> : null}
      {part.liveSource === "invalid" ? <p className="px-4 pb-2 text-xs text-[hsl(var(--e-danger))]">The last saved version is no longer valid for this notification, so the default is being sent. Save or restore a version to fix it.</p> : null}
      <div className="overflow-x-auto" role="region" aria-label="Versions" tabIndex={0}>
        <table className="w-full min-w-[34rem] text-left text-sm">
          <thead className="text-xs text-[hsl(var(--e-muted-foreground))]"><tr><th className="px-4 py-2">Version</th><th className="px-4 py-2">Saved</th><th className="px-4 py-2">By</th><th className="px-4 py-2">Change</th><th className="px-4 py-2"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {visible.map((version) => {
              const live = version.version === liveVersion;
              return (
                <tr key={version.version} className="border-t border-[hsl(var(--e-border))]">
                  <td className="whitespace-nowrap px-4 py-2 e-tnum">{live ? <b>v{version.version}</b> : `v${version.version}`} {live ? <EPill tone="ok">Live</EPill> : null}</td>
                  <td className="whitespace-nowrap px-4 py-2 e-tnum">{savedLabel(version, timeZone)}</td>
                  <td className="px-4 py-2">{version.actorName ?? <span className="text-[hsl(var(--e-muted-foreground))]">sNeek</span>}</td>
                  <td className="px-4 py-2">{version.change}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    <EButton size="sm" variant="ghost" onClick={() => setCompare(compare === version.version ? null : version.version)} aria-pressed={compare === version.version}>Compare</EButton>
                    {!live && canRestore ? <EButton size="sm" variant="outline" disabled={busy} onClick={() => onRestore(version.version)}>Restore</EButton> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {compared ? (
        <div className="grid gap-3 border-t border-[hsl(var(--e-border))] p-4 md:grid-cols-2" aria-label={`v${compared.version} compared with the live wording`}>
          {[{ label: `v${compared.version}`, fields: compared.fields }, { label: "Live now", fields: part.live }].map((side) => (
            <div key={side.label} className="min-w-0 space-y-1">
              <p className="text-xs font-semibold">{side.label}</p>
              {part.fields.map((field) => (
                <p key={field} className="whitespace-pre-wrap break-words rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2 text-xs">
                  <span className="block text-[hsl(var(--e-muted-foreground))]">{FIELD_LABEL[part.transport][field]}</span>{side.fields[field] ?? ""}
                </p>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
