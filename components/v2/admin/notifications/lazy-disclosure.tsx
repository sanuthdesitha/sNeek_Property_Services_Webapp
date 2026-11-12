"use client";

import * as React from "react";

/**
 * A disclosure whose content mounts on first open and then stays mounted, so
 * a secondary tool does not load until asked for and keeps its draft when it
 * is collapsed again.
 */
export function LazyDisclosure({ summary, id, children }: { summary: React.ReactNode; id?: string; children: React.ReactNode }) {
  const [opened, setOpened] = React.useState(false);
  return (
    <details
      id={id}
      className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] p-3"
      onToggle={(event) => {
        if ((event.currentTarget as HTMLDetailsElement).open) setOpened(true);
      }}
    >
      <summary className="min-h-9 cursor-pointer font-medium">{summary}</summary>
      {opened ? <div className="mt-3">{children}</div> : null}
    </details>
  );
}
