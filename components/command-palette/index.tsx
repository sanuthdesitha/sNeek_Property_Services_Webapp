"use client";
import * as React from "react";
import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { ROUTES } from "./routes";

export function CommandPalette() {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  if (!open) return null;

  const grouped = ROUTES.reduce<Record<string, typeof ROUTES>>((acc, r) => {
    (acc[r.group] ||= []).push(r);
    return acc;
  }, {});

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center bg-black/50 backdrop-blur-sm pt-[12vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-xl rounded-lg border border-border bg-surface shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <Command label="Command palette">
          <Command.Input
            placeholder="Type to search routes, clients, jobs…"
            className="w-full border-0 bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Command.List className="max-h-80 overflow-y-auto p-2">
            <Command.Empty className="px-4 py-3 text-sm text-muted-foreground">
              No results found.
            </Command.Empty>
            {Object.entries(grouped).map(([group, items]) => (
              <Command.Group key={group} heading={group} className="text-xs text-muted-foreground px-2 py-1">
                {items.map((r) => (
                  <Command.Item
                    key={r.id}
                    value={`${r.label} ${(r.keywords || []).join(" ")}`}
                    onSelect={() => {
                      setOpen(false);
                      router.push(r.href);
                    }}
                    className="cursor-pointer rounded px-2 py-1.5 text-sm text-foreground aria-selected:bg-surface-raised"
                  >
                    {r.label}
                  </Command.Item>
                ))}
              </Command.Group>
            ))}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
