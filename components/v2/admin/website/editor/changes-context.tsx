"use client";

/**
 * Unsaved-change marks for the website editor (board "Website and blog").
 * The editor provides the published content and the changed paths; a field
 * wrapped in `ChangedField` gets an amber outline and "changed · was …" in its
 * label when its value differs from what is live.
 */
import * as React from "react";
import type { WebsiteContent } from "@/lib/public-site/content";
import { pathWithin, valueAtPath } from "@/lib/public-site/website-draft";
import { EField } from "@/components/v2/admin/estate-kit";
import { cn } from "@/lib/utils";

export type WebsiteChanges = {
  published: WebsiteContent;
  paths: string[];
};

const WebsiteChangesContext = React.createContext<WebsiteChanges | null>(null);

export function WebsiteChangesProvider({ value, children }: { value: WebsiteChanges; children: React.ReactNode }) {
  return <WebsiteChangesContext.Provider value={value}>{children}</WebsiteChangesContext.Provider>;
}

export const CHANGED_OUTLINE_CLASS = "outline outline-2 outline-offset-1 outline-[hsl(var(--e-warning)/0.6)]";

export type FieldChange = { changed: boolean; was: unknown };

export function useFieldChange(path: string | undefined): FieldChange {
  const context = React.useContext(WebsiteChangesContext);
  if (!context || !path) return { changed: false, was: undefined };
  const changed = context.paths.some((item) => pathWithin(item, path));
  return { changed, was: changed ? valueAtPath(context.published, path) : undefined };
}

/** Number of unsaved changed paths inside any of `prefixes`. */
export function useChangeCount(prefixes: string[]): number {
  const context = React.useContext(WebsiteChangesContext);
  if (!context) return 0;
  return context.paths.filter((item) => prefixes.some((prefix) => pathWithin(item, prefix))).length;
}

function wasText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return "empty";
  return trimmed.length > 60 ? `"${trimmed.slice(0, 57)}…"` : `"${trimmed}"`;
}

/** The small amber "changed" note for a label. */
export function ChangedNote({ change, showWas = true }: { change: FieldChange; showWas?: boolean }) {
  if (!change.changed) return null;
  const was = showWas ? wasText(change.was) : null;
  return (
    <span className="ml-1.5 text-[0.6875rem] font-[600] text-[hsl(var(--e-warning))]">
      changed{was ? ` · was ${was}` : ""}
    </span>
  );
}

/**
 * EField whose single control is outlined when `path` has an unsaved change.
 * The control keeps its own label association (EField), no wrapper element.
 */
export function ChangedField({
  path,
  label,
  hint,
  showWas = true,
  children,
}: {
  path: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  showWas?: boolean;
  children: React.ReactElement<{ className?: string }>;
}) {
  const change = useFieldChange(path);
  const control = change.changed
    ? React.cloneElement(children, { className: cn(children.props.className, CHANGED_OUTLINE_CLASS) })
    : children;
  return (
    <EField
      label={
        <>
          {label}
          <ChangedNote change={change} showWas={showWas} />
        </>
      }
      hint={hint}
    >
      {control}
    </EField>
  );
}
