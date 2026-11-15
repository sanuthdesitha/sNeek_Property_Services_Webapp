"use client";

/**
 * The Test as people list (board "Test as"): one list grouped by portal, with
 * search and role chips. Each person shows email (and client) and last seen,
 * so the right Marco is picked. View only starts at once; Full access asks a
 * tier A confirmation that lists what stays blocked. The mode is chosen for
 * each person, every time, and defaults to the safe one.
 */
import * as React from "react";
import { formatInTimeZone } from "date-fns-tz";
import { Eye, Loader2, Search } from "lucide-react";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { EFilterChips } from "@/components/v2/ui/filter-chips";
import { EConfirmDialog } from "@/components/v2/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { IMPERSONATION_MAX_AGE_SECONDS } from "@/lib/auth/impersonation-limits";
import {
  TESTABLE_PORTALS,
  TEST_AS_GROUP_PREVIEW,
  TEST_AS_PRIMARY_ROLES,
  type TestableRole,
} from "@/lib/auth/test-as-rules";

export type TestAsCandidate = {
  id: string;
  name: string | null;
  email: string | null;
  role: TestableRole;
  /** The client account a client login belongs to, shown before the email. */
  clientName: string | null;
  /** "last seen today 09:40", "last seen Fri 13 Nov" or "not seen yet" (organisation time). */
  lastSeenLabel: string;
};

type Mode = "READ_ONLY" | "FULL";
type ChipValue = "ALL" | TestableRole;

function initials(person: TestAsCandidate): string {
  const source = (person.name || person.email || "?").trim();
  const words = source.split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "?") + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase();
}

function displayName(person: TestAsCandidate): string {
  return person.name || person.email || "Unnamed";
}

function matches(person: TestAsCandidate, query: string): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return [person.name, person.email, person.clientName].some((value) => value?.toLowerCase().includes(needle));
}

function PersonRow({
  person,
  chosen,
  disabled,
  pending,
  onView,
  onFull,
}: {
  person: TestAsCandidate;
  chosen: boolean;
  disabled: boolean;
  pending: boolean;
  onView: () => void;
  onFull: () => void;
}) {
  const ref = React.useRef<HTMLLIElement>(null);
  React.useEffect(() => {
    if (chosen) ref.current?.scrollIntoView({ block: "center" });
  }, [chosen]);
  const sub = [person.clientName, person.email, person.lastSeenLabel].filter(Boolean).join(" · ");
  return (
    <li
      ref={ref}
      data-chosen={chosen || undefined}
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-[hsl(var(--e-border))] px-4 py-3",
        chosen && "bg-[hsl(var(--e-band-info-bg))]",
      )}
    >
      <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--e-surface-sunken))] text-[0.75rem] font-[600] text-[hsl(var(--e-text-secondary))]">
        {initials(person)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[0.875rem] font-[600]">{displayName(person)}</p>
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))] [overflow-wrap:anywhere]">{sub}</p>
      </div>
      <div className="flex shrink-0 gap-2 max-sm:w-full">
        <EButton size="sm" variant="outline" disabled={disabled} onClick={onView} className="max-sm:flex-1" aria-label={`View only as ${displayName(person)}`}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
          View only
        </EButton>
        <EButton size="sm" variant="outline-gold" disabled={disabled} onClick={onFull} className="max-sm:flex-1" aria-label={`Full access as ${displayName(person)}…`}>
          Full access…
        </EButton>
      </div>
    </li>
  );
}

export function TestAsPicker({
  people,
  timeZone,
  chosenId = null,
}: {
  people: TestAsCandidate[];
  timeZone: string;
  /** Highlighted after the unlock lapsed mid-choice and the PIN was given again. */
  chosenId?: string | null;
}) {
  const [query, setQuery] = React.useState("");
  const [chip, setChip] = React.useState<ChipValue>("ALL");
  const [openGroups, setOpenGroups] = React.useState<ReadonlySet<TestableRole>>(new Set());
  const [showOthers, setShowOthers] = React.useState(false);
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [confirming, setConfirming] = React.useState<TestAsCandidate | null>(null);
  const [confirmError, setConfirmError] = React.useState<string | null>(null);
  const [endsAtLabel, setEndsAtLabel] = React.useState("");

  const counts = React.useMemo(() => {
    const byRole = new Map<TestableRole, number>();
    for (const person of people) byRole.set(person.role, (byRole.get(person.role) ?? 0) + 1);
    return byRole;
  }, [people]);

  const chips: Array<{ key: ChipValue; label: string; count: number }> = [
    { key: "ALL", label: "All", count: people.length },
    ...TESTABLE_PORTALS.filter((portal) => (counts.get(portal.role) ?? 0) > 0).map((portal) => ({ key: portal.role as ChipValue, label: portal.label, count: counts.get(portal.role) ?? 0 })),
  ];

  const filtering = query.trim() !== "" || chip !== "ALL";
  const visible = people.filter((person) => (chip === "ALL" || person.role === chip) && matches(person, query.trim()));
  const groups = TESTABLE_PORTALS.map((portal) => ({ ...portal, people: visible.filter((person) => person.role === portal.role) })).filter((group) => group.people.length > 0);
  const primary = filtering ? groups : groups.filter((group) => TEST_AS_PRIMARY_ROLES.includes(group.role));
  const others = filtering ? [] : groups.filter((group) => !TEST_AS_PRIMARY_ROLES.includes(group.role));
  const shownGroups = showOthers ? [...primary, ...others] : primary;
  const busy = pendingId !== null;

  async function start(person: TestAsCandidate, mode: Mode) {
    setPendingId(person.id);
    setError(null);
    setConfirmError(null);
    try {
      const response = await fetch("/api/admin/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: person.id, mode }),
      });
      const data = (await response.json().catch(() => ({}))) as { home?: string; error?: string; code?: string };
      if (!response.ok) {
        // The 15-minute unlock lapsed while the page sat open: back to the PIN
        // step, with the chosen person still highlighted afterwards.
        if (data.code === "TEST_AS_LOCKED") {
          window.location.assign(`/v2/admin/system/test-as?chosen=${encodeURIComponent(person.id)}&relock=1`);
          return;
        }
        const message = data.error ?? "Could not start the test session.";
        if (mode === "FULL") setConfirmError(`It did not start: ${message}`);
        else setError(message);
        setPendingId(null);
        return;
      }
      // Full page load: every server component must pick up the new identity.
      window.location.href = data.home ?? "/v2";
    } catch {
      const message = "Could not reach the server. Nothing started; try again.";
      if (mode === "FULL") setConfirmError(message);
      else setError(message);
      setPendingId(null);
    }
  }

  function askFull(person: TestAsCandidate) {
    setConfirmError(null);
    setEndsAtLabel(formatInTimeZone(Date.now() + IMPERSONATION_MAX_AGE_SECONDS * 1000, timeZone, "HH:mm"));
    setConfirming(person);
  }

  function toggleGroup(role: TestableRole) {
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label htmlFor="test-as-search" className="text-[0.75rem] font-[600] text-[hsl(var(--e-text-secondary))]">Search name or email</label>
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--e-muted-foreground))]" />
          <input
            id="test-as-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            disabled={busy}
            placeholder="Marco, priya@…"
            className="h-11 w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] pl-9 pr-3 text-[0.875rem] max-sm:text-[1rem]"
          />
        </div>
      </div>
      <EFilterChips label="Portal" chips={chips} active={chip} onChange={setChip} disabled={busy} phoneLayout="carousel" />

      {error ? (
        <p role="alert" className="text-[0.8125rem] font-[550] text-[hsl(var(--e-danger))]">{error}</p>
      ) : null}

      <ECard className="overflow-hidden">
        {visible.length === 0 ? (
          <p className="px-4 py-6 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
            {people.length === 0 ? "No active accounts to test as yet." : `No one matches “${query.trim()}”.`}
          </p>
        ) : (
          <>
            {shownGroups.map((group) => {
              const open = filtering || openGroups.has(group.role) || !TEST_AS_PRIMARY_ROLES.includes(group.role);
              const rows = open ? group.people : group.people.slice(0, TEST_AS_GROUP_PREVIEW);
              const hidden = group.people.length - rows.length;
              return (
                <section key={group.role} aria-label={group.label}>
                  <div className="flex items-center justify-between gap-3 bg-[hsl(var(--e-surface-sunken))] px-4 py-2.5 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-[hsl(var(--e-border))]">
                    <h3 className="text-[0.8125rem] font-[600]">{group.label}</h3>
                    <span className="font-mono text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{group.portal}</span>
                  </div>
                  <ul>
                    {rows.map((person) => (
                      <PersonRow
                        key={person.id}
                        person={person}
                        chosen={person.id === chosenId}
                        disabled={busy}
                        pending={pendingId === person.id}
                        onView={() => void start(person, "READ_ONLY")}
                        onFull={() => askFull(person)}
                      />
                    ))}
                  </ul>
                  {hidden > 0 || (openGroups.has(group.role) && group.people.length > TEST_AS_GROUP_PREVIEW && !filtering) ? (
                    <div className="flex items-center justify-between border-t border-[hsl(var(--e-border))] px-4 py-2 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                      <span>{hidden > 0 ? `${hidden} more ${group.label.toLowerCase()}` : `All ${group.people.length} ${group.label.toLowerCase()}`}</span>
                      <button type="button" onClick={() => toggleGroup(group.role)} className="min-h-11 px-1 font-[600] text-[hsl(var(--e-foreground))] underline underline-offset-2 max-sm:min-h-11 sm:min-h-8">
                        {hidden > 0 ? "Show" : "Show fewer"}
                      </button>
                    </div>
                  ) : null}
                </section>
              );
            })}
            {!showOthers && others.length > 0 ? (
              <div className="border-t border-[hsl(var(--e-border))]">
                <div className="flex items-center justify-between gap-3 bg-[hsl(var(--e-surface-sunken))] px-4 py-2.5">
                  <h3 className="text-[0.8125rem] font-[600]">{others.map((group) => group.label).join(" · ")}</h3>
                  <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{others.reduce((sum, group) => sum + group.people.length, 0)} people</span>
                </div>
                <div className="flex items-center justify-between gap-3 px-4 py-2 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                  <span className="min-w-0 truncate">{others.flatMap((group) => group.people.map(displayName)).join(", ")}</span>
                  <button type="button" onClick={() => setShowOthers(true)} className="min-h-11 shrink-0 px-1 font-[600] text-[hsl(var(--e-foreground))] underline underline-offset-2 sm:min-h-8">
                    Show
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
        <p className="border-t border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))] px-4 py-2.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          Administrators cannot be tested as. Only active accounts are listed.
        </p>
      </ECard>

      <EConfirmDialog
        open={confirming !== null}
        onClose={() => {
          if (!busy) setConfirming(null);
        }}
        tier="ordinary"
        title={confirming ? `Full access as ${displayName(confirming)}?` : "Full access?"}
        description={
          confirming
            ? `Anything you do is saved for real under their name: starting a job, submitting a form, messaging the office. Actions that ask for a PIN, their devices, notification choices and location stay blocked. It ends by itself at ${endsAtLabel}.`
            : undefined
        }
        confirmLabel="Start full access"
        busy={busy}
        error={confirmError}
        onConfirm={() => (confirming ? start(confirming, "FULL") : undefined)}
      />
    </div>
  );
}
