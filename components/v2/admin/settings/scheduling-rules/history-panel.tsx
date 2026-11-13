"use client";

/**
 * Version history: every published version (never edited or deleted), who
 * published it, why, from when, and its status. Compare any two versions in
 * plain words; restore one as a NEW version through the same review, PIN and
 * effective-date steps (only while unlocked).
 */
import * as React from "react";
import { EBadge, EButton, ECard, ECardBody, ECardHeader, ECardTitle } from "@/components/v2/ui/primitives";
import { ESelect } from "@/components/v2/admin/estate-kit";
import { formatRuleValue } from "@/lib/scheduling-rules/registry";
import { draftChanges } from "@/lib/scheduling-rules/draft";
import type { RuleVersionView, SchedulingRulesView } from "@/lib/scheduling-rules/view-types";

const STATUS_TONE: Record<RuleVersionView["status"], "success" | "info" | "neutral"> = { LIVE: "success", SCHEDULED: "info", SUPERSEDED: "neutral" };
const STATUS_LABEL: Record<RuleVersionView["status"], string> = { LIVE: "Live", SCHEDULED: "Scheduled", SUPERSEDED: "Earlier" };

type Props = {
  view: SchedulingRulesView;
  unlocked: boolean;
  busy: boolean;
  onRestore: (version: RuleVersionView) => void;
};

export function HistoryPanel({ view, unlocked, busy, onRestore }: Props) {
  const versions = view.versions;
  const [left, setLeft] = React.useState<number>(versions[versions.length - 1]?.version ?? 1);
  const [right, setRight] = React.useState<number>(view.liveVersion);
  const from = versions.find((version) => version.version === left);
  const to = versions.find((version) => version.version === right);
  const differences = from && to ? draftChanges(from.values, to.values) : [];
  const titleOf = (key: string) => view.rules.find((row) => row.editableKey === key)?.title ?? key;

  return (
    <div className="space-y-4">
      <ECard>
        <ECardHeader>
          <ECardTitle>Compare two versions</ECardTitle>
        </ECardHeader>
        <ECardBody className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-[0.875rem]">
            <label className="flex items-center gap-2">From
              <ESelect aria-label="Compare from version" value={String(left)} onChange={(event) => setLeft(Number(event.target.value))}>
                {versions.map((version) => <option key={version.version} value={version.version}>Version {version.version}</option>)}
              </ESelect>
            </label>
            <label className="flex items-center gap-2">to
              <ESelect aria-label="Compare to version" value={String(right)} onChange={(event) => setRight(Number(event.target.value))}>
                {versions.map((version) => <option key={version.version} value={version.version}>Version {version.version}</option>)}
              </ESelect>
            </label>
          </div>
          {differences.length === 0 ? (
            <p className="text-[0.875rem]">These versions have the same rule values.</p>
          ) : (
            <ul className="space-y-1 text-[0.875rem]">
              {differences.map((change) => (
                <li key={change.key} className="break-words"><span className="font-medium">{titleOf(change.key)}</span>: {formatRuleValue(change.key, change.from)} → <strong>{formatRuleValue(change.key, change.to)}</strong></li>
              ))}
            </ul>
          )}
        </ECardBody>
      </ECard>

      <ol className="space-y-3">
        {versions.map((version) => (
          <li key={version.version}>
            <ECard>
              <ECardBody className="space-y-2 text-[0.875rem]">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">Version {version.version}</p>
                  <EBadge tone={STATUS_TONE[version.status]} soft>{STATUS_LABEL[version.status]}</EBadge>
                  <span className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{version.label}</span>
                </div>
                <p className="break-words">{version.reason}</p>
                <p className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">
                  {version.effectiveLabel} · published {version.createdAt}{version.createdBy ? ` by ${version.createdBy}` : ""}
                  {version.kind !== "ORIGINAL" ? ` · ${version.changeCount} change${version.changeCount === 1 ? "" : "s"}` : ""}
                  {version.appliesToExisting ? " · re-planned existing runs and jobs" : ""}
                  {version.restoredFromVersion ? ` · restored from version ${version.restoredFromVersion}` : ""}
                </p>
                {view.canEdit && version.status !== "LIVE" ? (
                  <EButton variant="outline" size="sm" disabled={!unlocked || busy} onClick={() => onRestore(version)} title={unlocked ? undefined : "Unlock the rules first"}>
                    Restore this version…
                  </EButton>
                ) : null}
              </ECardBody>
            </ECard>
          </li>
        ))}
      </ol>
    </div>
  );
}
