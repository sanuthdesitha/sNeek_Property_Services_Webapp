"use client";

/**
 * Builder page header, as drawn: "← Forms", the form name as the page's one
 * h1 with its state pill, a line saying which version is live where and when
 * the draft was saved, then Undo, Redo, Versions, Test as cleaner, a "More"
 * menu (form settings, duplicate, archive, discard draft) and the primary
 * "Publish vN".
 */
import * as React from "react";
import Link from "next/link";
import { Redo2, Undo2 } from "lucide-react";
import { EButton } from "@/components/v2/ui/primitives";
import { EPill } from "@/components/v2/ui/pill";
import { ERowMenu, type ERowMenuItem } from "@/components/v2/ui/row-menu";
import type { FormUsage } from "@/lib/forms/library-types";
import type { SaveState } from "./use-draft-autosave";
import { InlineFormName, type RenameOutcome } from "./inline-form-name";

export type BuilderStatus = {
  liveVersion: number;
  isActive: boolean;
  archived: boolean;
  /** A draft exists on the server or edits are not yet saved. */
  hasDraft: boolean;
};

export function statePill(status: BuilderStatus): { label: string; tone: "info" | "ok" | "neutral" | "warn" } {
  if (status.archived) return { label: `Archived v${status.liveVersion}`, tone: "neutral" };
  if (status.hasDraft) return { label: `Draft of v${status.liveVersion + 1}`, tone: "info" };
  if (status.isActive) return { label: `Live v${status.liveVersion}`, tone: "ok" };
  return { label: `Not live (v${status.liveVersion})`, tone: "warn" };
}

/** The version a publish would create, or null when there is nothing to publish. */
export function publishTarget(status: BuilderStatus): number | null {
  if (status.archived) return null;
  if (status.hasDraft) return status.liveVersion + 1;
  if (!status.isActive) return status.liveVersion;
  return null;
}

export function usageSentence(liveVersion: number, isActive: boolean, usage: FormUsage | null | undefined): string {
  if (usage === undefined || usage === null) return isActive ? `v${liveVersion} is live · where it is used could not be read` : `v${liveVersion} is not live`;
  switch (usage.kind) {
    case "default":
      return `v${liveVersion} is live on ${usage.properties} propert${usage.properties === 1 ? "y" : "ies"} (the default for its service type)`;
    case "property":
      return `v${liveVersion} is live on ${usage.properties} propert${usage.properties === 1 ? "y" : "ies"} (set on the property)`;
    case "job":
      return `v${liveVersion} is live for one job`;
    case "unused":
      return `v${liveVersion} is published, but no property resolves to it`;
    default:
      return `v${liveVersion} is not live`;
  }
}

export function savedSentence(state: SaveState, now: number): string {
  if (state.status === "saving") return "saving the draft…";
  if (state.status === "failed") return "draft NOT saved";
  if (state.status === "conflict") return "draft not saved — changed elsewhere";
  if (state.status === "dirty") return "unsaved edits";
  if (!state.savedAt) return "no unpublished changes";
  const seconds = Math.max(0, Math.round((now - state.savedAt.getTime()) / 1000));
  if (seconds < 10) return "draft saved just now";
  if (seconds < 60) return `draft saved ${seconds} seconds ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `draft saved ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  return `draft saved at ${state.savedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function useNow(intervalMs: number): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function BuilderHeader({
  name,
  status,
  usage,
  saveState,
  canUndo,
  canRedo,
  busy,
  onUndo,
  onRedo,
  onVersions,
  onTest,
  onPublish,
  menuItems,
  onLeave,
  onRename,
}: {
  name: string;
  /** Rename in place (metadata PATCH with the stale-write guard). */
  onRename: (next: string) => Promise<RenameOutcome>;
  status: BuilderStatus;
  usage: FormUsage | null | undefined;
  saveState: SaveState;
  canUndo: boolean;
  canRedo: boolean;
  busy: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onVersions: () => void;
  onTest: () => void;
  onPublish: () => void;
  menuItems: ERowMenuItem[];
  /** Called before following "← Forms"; return false to stay. */
  onLeave: () => boolean;
}) {
  const now = useNow(15_000);
  const pill = statePill(status);
  const target = publishTarget(status);
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <Link
          href="/v2/admin/forms"
          onClick={(event) => {
            if (!onLeave()) event.preventDefault();
          }}
          className="text-[0.8125rem] font-[550] text-[hsl(var(--e-primary))] hover:underline"
        >
          ← Forms
        </Link>
        <InlineFormName name={name} disabled={busy || status.archived} onRename={onRename}>
          <EPill tone={pill.tone} className="align-middle">{pill.label}</EPill>
        </InlineFormName>
        <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]" aria-live="polite">
          {usageSentence(status.liveVersion, status.isActive && !status.archived, usage)} ·{" "}
          <span className={saveState.status === "failed" || saveState.status === "conflict" ? "font-[600] text-[hsl(var(--e-danger))]" : undefined}>
            {savedSentence(saveState, now)}
          </span>
        </p>
      </div>
      <div className="flex max-w-full flex-wrap items-center gap-2">
        <EButton variant="outline" size="icon" className="h-8 w-8" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!canUndo || busy} onClick={onUndo}>
          <Undo2 className="size-4" />
        </EButton>
        <EButton variant="outline" size="icon" className="h-8 w-8" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo || busy} onClick={onRedo}>
          <Redo2 className="size-4" />
        </EButton>
        <EButton variant="outline" size="sm" onClick={onVersions}>
          Versions
        </EButton>
        <EButton variant="outline" size="sm" onClick={onTest}>
          Test as cleaner
        </EButton>
        <ERowMenu label="More form actions" items={menuItems} />
        <EButton
          size="sm"
          onClick={onPublish}
          disabled={busy || target === null}
          title={target === null ? (status.archived ? "Unarchive the form before publishing." : "Nothing new to publish.") : undefined}
        >
          {target === null ? (status.archived ? "Archived" : "Published") : `Publish v${target}`}
        </EButton>
      </div>
    </header>
  );
}
