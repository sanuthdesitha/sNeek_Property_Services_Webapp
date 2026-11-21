"use client";

/**
 * Everyone who has switched a notification off (people and client accounts),
 * newest change first, each linking to their Notifications tab where an
 * administrator sees the same switches they do. Loads when opened.
 */
import * as React from "react";
import { EButton } from "@/components/v2/ui/primitives";
import type { OffListEntry } from "@/lib/notifications/personal/view-types";

type LoadState = { kind: "loading" } | { kind: "failed"; message: string } | { kind: "ready"; people: OffListEntry[] };

const ROLE_LABEL: Record<string, string> = {
  CLIENT: "Client", CLEANER: "Cleaner", LAUNDRY: "Laundry", QA_INSPECTOR: "QA", MAINTENANCE: "Maintenance", ADMIN: "Administrator", OPS_MANAGER: "Operations manager", VA: "Client assistant",
};

export function SwitchedOffPeople({ timeZone }: { timeZone: string }) {
  const [load, setLoad] = React.useState<LoadState>({ kind: "loading" });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    const controller = new AbortController();
    setLoad({ kind: "loading" });
    void (async () => {
      try {
        const res = await fetch("/api/admin/notifications/switches/off", { cache: "no-store", signal: controller.signal });
        const body = await res.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!res.ok || !Array.isArray(body?.people)) {
          setLoad({ kind: "failed", message: typeof body?.error === "string" ? body.error : "The list could not be loaded." });
          return;
        }
        setLoad({ kind: "ready", people: body.people as OffListEntry[] });
      } catch {
        if (!controller.signal.aborted) setLoad({ kind: "failed", message: "The list could not be loaded." });
      }
    })();
    return () => controller.abort();
  }, [attempt]);

  if (load.kind === "loading") return <p role="status" className="text-sm text-[hsl(var(--e-muted-foreground))]">Loading…</p>;
  if (load.kind === "failed") {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
        {load.message} Nothing is shown rather than a guess.
        <EButton size="sm" variant="outline" onClick={() => setAttempt((value) => value + 1)}>Try again</EButton>
      </div>
    );
  }
  if (load.people.length === 0) return <p className="text-sm text-[hsl(var(--e-muted-foreground))]">Nobody has switched anything off.</p>;
  const format = new Intl.DateTimeFormat("en-AU", { timeZone, day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <ul className="flex flex-col divide-y divide-[hsl(var(--e-border))] text-sm">
      {load.people.map((person) => (
        <li key={`${person.kind}:${person.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <div className="min-w-0">
            <a className="font-medium underline [overflow-wrap:anywhere]" href={person.href}>{person.name ?? "Unnamed"}</a>
            <span className="ml-2 text-[hsl(var(--e-muted-foreground))]">{person.kind === "CLIENT" ? "Client account" : ROLE_LABEL[person.role] ?? person.role}</span>
            <p className="text-[0.8125rem]">{person.summary}</p>
          </div>
          <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            {person.lastChange ? `Changed by ${person.lastChange.byName ?? "someone"}, ${format.format(new Date(person.lastChange.at))}` : "Change not recorded (set before 21 Nov 2026)"}
          </span>
        </li>
      ))}
    </ul>
  );
}
