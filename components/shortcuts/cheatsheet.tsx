"use client";
import * as React from "react";
import { useShortcut, getRegisteredShortcuts } from "@/hooks/use-keyboard-shortcuts";

export function ShortcutCheatsheet() {
  const [open, setOpen] = React.useState(false);

  useShortcut({
    keys: "?",
    label: "Show keyboard shortcuts",
    group: "Help",
    handler: () => setOpen(true),
  });

  if (!open) return null;

  const shortcuts = getRegisteredShortcuts();
  const byGroup = shortcuts.reduce<Record<string, typeof shortcuts>>((acc, s) => {
    const g = s.group || "Other";
    (acc[g] ||= []).push(s);
    return acc;
  }, {});

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">Keyboard Shortcuts</h2>
        <div className="mt-4 space-y-4">
          {Object.entries(byGroup).map(([group, items]) => (
            <div key={group}>
              <h3 className="text-xs font-semibold uppercase text-muted-foreground">{group}</h3>
              <ul className="mt-2 space-y-1">
                {items.map((s) => (
                  <li key={s.keys} className="flex justify-between text-sm">
                    <span>{s.label}</span>
                    <kbd className="rounded border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-xs">
                      {s.keys}
                    </kbd>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <button
          onClick={() => setOpen(false)}
          className="mt-6 w-full rounded bg-primary px-3 py-2 text-sm text-primary-foreground"
        >
          Close
        </button>
      </div>
    </div>
  );
}
