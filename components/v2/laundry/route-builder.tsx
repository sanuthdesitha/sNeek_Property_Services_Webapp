"use client";

/**
 * ESTATE laundry route builder — mobile-first planner for /v2/laundry/route.
 *
 * Data: GET /api/laundry/route → { route, candidates, tasks }. Candidates are
 * grouped Today / Tomorrow (pull-forward) / Overdue with due badges; tapping a
 * candidate adds/removes it from the plan. Selected stops reorder with up/down
 * arrows (deliberately no drag on a bumpy van ride). Newly added stops slot in
 * by the shared time+suburb comparator (lib/laundry/route-plan). "Save draft"
 * POSTs the plan; "Start route" POSTs with activate:true and flips this page
 * into runner mode (the same ACTIVE-route surface as the Today page).
 */
import * as React from "react";
import { format } from "date-fns";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CalendarClock,
  KeyRound,
  Play,
  Plus,
  RefreshCw,
  Save,
  X,
} from "lucide-react";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
  EEyebrow,
} from "@/components/v2/ui/primitives";
import { toast } from "@/hooks/use-toast";
import { compareByTimeThenSuburb, type RouteStopKind } from "@/lib/laundry/route-plan";
import { LaundryRouteMap } from "@/components/v2/laundry/route-map";

type Candidate = {
  taskId: string;
  kind: RouteStopKind;
  bucket: "TODAY" | "TOMORROW" | "OVERDUE";
  dueDate: string;
  overdueDays: number;
  propertyId: string;
  propertyName: string;
  suburb: string | null;
  status: string;
  keyLostMode: boolean;
  lat: number | null;
  lng: number | null;
  scheduledAt: string;
};

type ApiRoute = {
  id: string;
  date: string;
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  stops: Array<{
    taskId: string;
    kind: RouteStopKind;
    order: number;
    propertyId: string;
    arrivedAt?: string | null;
    completedAt?: string | null;
  }>;
};

type SelectedStop = { candidate: Candidate };

const keyOf = (s: { taskId: string; kind: RouteStopKind }) => `${s.taskId}:${s.kind}`;

function dueLabel(c: Candidate): string {
  if (c.bucket === "TODAY") return "Today";
  if (c.bucket === "TOMORROW") return "Tomorrow";
  return `${c.overdueDays}d overdue`;
}

function statusLabel(status: string): string {
  return status.replace(/_/g, " ").toLowerCase();
}

function CandidateRow({
  candidate,
  selected,
  onToggle,
}: {
  candidate: Candidate;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex w-full items-center justify-between gap-2 rounded-[var(--e-radius-lg)] border px-3 py-2.5 text-left transition-colors ${
        selected
          ? "border-[hsl(var(--e-accent-portal))] bg-[hsl(var(--e-surface-raised))]"
          : "border-[hsl(var(--e-border))] hover:border-[hsl(var(--e-border-strong))]"
      }`}
    >
      <div className="min-w-0">
        <p className="truncate text-[0.875rem] font-medium text-[hsl(var(--e-foreground))]">
          {candidate.propertyName}
          {candidate.suburb ? (
            <span className="ml-1 font-normal text-[hsl(var(--e-muted-foreground))]">
              · {candidate.suburb}
            </span>
          ) : null}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
          <EBadge tone={candidate.kind === "PICKUP" ? "info" : "primary"} soft>
            {candidate.kind === "PICKUP" ? "Pickup" : "Drop-off"}
          </EBadge>
          <EBadge tone={candidate.bucket === "OVERDUE" ? "danger" : "neutral"} soft>
            {dueLabel(candidate)}
          </EBadge>
          <span>{statusLabel(candidate.status)}</span>
          {candidate.keyLostMode ? (
            <span className="inline-flex items-center gap-0.5 text-[hsl(var(--e-gold-ink))]">
              <KeyRound className="h-3 w-3" /> key-lost
            </span>
          ) : null}
        </p>
      </div>
      <span className="shrink-0 text-[hsl(var(--e-accent-portal))]">
        {selected ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
      </span>
    </button>
  );
}

export function RouteBuilder() {
  const [candidates, setCandidates] = React.useState<Candidate[]>([]);
  const [route, setRoute] = React.useState<ApiRoute | null>(null);
  const [selected, setSelected] = React.useState<SelectedStop[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState<null | "draft" | "start">(null);
  const [errored, setErrored] = React.useState(false);
  const hydratedRef = React.useRef(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/laundry/route", { cache: "no-store" });
      if (!res.ok) throw new Error("route feed failed");
      const data = await res.json();
      const cands: Candidate[] = Array.isArray(data?.candidates) ? data.candidates : [];
      setCandidates(cands);
      setRoute(data?.route ?? null);

      // Hydrate the plan once from a saved DRAFT so a reload doesn't lose it.
      if (!hydratedRef.current) {
        hydratedRef.current = true;
        const draft: ApiRoute | null = data?.route ?? null;
        if (draft && draft.status === "DRAFT") {
          const byKey = new Map(cands.map((c) => [keyOf(c), c]));
          setSelected(
            [...draft.stops]
              .sort((a, b) => a.order - b.order)
              .map((s) => byKey.get(keyOf(s)))
              .filter((c): c is Candidate => Boolean(c))
              .map((candidate) => ({ candidate })),
          );
        }
      }
      setErrored(false);
    } catch {
      setErrored(true);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const selectedKeys = React.useMemo(
    () => new Set(selected.map((s) => keyOf(s.candidate))),
    [selected],
  );

  const toggle = React.useCallback((candidate: Candidate) => {
    setSelected((prev) => {
      const k = keyOf(candidate);
      if (prev.some((s) => keyOf(s.candidate) === k)) {
        return prev.filter((s) => keyOf(s.candidate) !== k);
      }
      // Initial slot for a new stop: keep the list in time+suburb order
      // relative to the already-chosen stops (manual reordering after that
      // is preserved — we only sort the insertion point, not the whole list).
      const next = [...prev];
      const insertAt = next.findIndex(
        (s) =>
          compareByTimeThenSuburb(
            { scheduledAt: candidate.scheduledAt, suburb: candidate.suburb },
            { scheduledAt: s.candidate.scheduledAt, suburb: s.candidate.suburb },
          ) < 0,
      );
      if (insertAt === -1) next.push({ candidate });
      else next.splice(insertAt, 0, { candidate });
      return next;
    });
  }, []);

  const move = React.useCallback((index: number, delta: -1 | 1) => {
    setSelected((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return next;
    });
  }, []);

  const save = React.useCallback(
    async (activate: boolean) => {
      if (selected.length === 0) {
        toast({ title: "Add at least one stop first.", variant: "destructive" });
        return;
      }
      setSaving(activate ? "start" : "draft");
      try {
        const res = await fetch("/api/laundry/route", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            date: new Date().toISOString(),
            stops: selected.map((s, order) => ({
              taskId: s.candidate.taskId,
              kind: s.candidate.kind,
              order,
              propertyId: s.candidate.propertyId,
            })),
            activate,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          toast({
            title: "Could not save the route",
            description: data?.error ?? "Please try again.",
            variant: "destructive",
          });
          return;
        }
        setRoute(data?.route ?? null);
        toast({
          title: activate ? "Route started" : "Draft saved",
          description: activate
            ? "GPS sharing begins on the live route surface."
            : `${selected.length} stop${selected.length === 1 ? "" : "s"} saved for today.`,
        });
      } finally {
        setSaving(null);
      }
    },
    [selected],
  );

  // Runner mode: an ACTIVE route exists — show the live route surface instead
  // of the planner (same component the Today dashboard embeds).
  if (route?.status === "ACTIVE") {
    return <LaundryRouteMap />;
  }

  const groups: Array<{ label: string; bucket: Candidate["bucket"]; icon?: React.ReactNode }> = [
    { label: "Today", bucket: "TODAY" },
    { label: "Tomorrow (pull forward)", bucket: "TOMORROW" },
    { label: "Overdue", bucket: "OVERDUE", icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <EEyebrow>ROUTE BUILDER</EEyebrow>
          <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Tap stops to add them, reorder with the arrows, then start the run.
          </p>
        </div>
        <EButton variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </EButton>
      </div>

      {/* Selected stops — the plan */}
      <ECard>
        <ECardHeader>
          <ECardTitle>
            Your route{" "}
            <span className="e-tnum text-[0.8125rem] font-normal text-[hsl(var(--e-muted-foreground))]">
              {selected.length} stop{selected.length === 1 ? "" : "s"}
            </span>
          </ECardTitle>
        </ECardHeader>
        <ECardBody className="space-y-3">
          {selected.length === 0 ? (
            <p className="rounded-[var(--e-radius-lg)] border border-dashed border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface-raised))] p-5 text-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              No stops yet — pick from the lists below. New stops slot in by
              scheduled time, then suburb.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {selected.map((s, index) => (
                <li
                  key={keyOf(s.candidate)}
                  className="flex items-center justify-between gap-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="e-tnum flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] text-[0.75rem] font-semibold">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[0.875rem] font-medium">
                        {s.candidate.propertyName}
                      </p>
                      <p className="e-tnum truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        {s.candidate.kind === "PICKUP" ? "Pickup" : "Drop-off"}
                        {s.candidate.suburb ? ` · ${s.candidate.suburb}` : ""} ·{" "}
                        {dueLabel(s.candidate)} ·{" "}
                        {format(new Date(s.candidate.scheduledAt), "EEE HH:mm")}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <EButton
                      variant="outline"
                      size="sm"
                      aria-label="Move up"
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </EButton>
                    <EButton
                      variant="outline"
                      size="sm"
                      aria-label="Move down"
                      disabled={index === selected.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </EButton>
                    <EButton
                      variant="outline"
                      size="sm"
                      aria-label="Remove stop"
                      onClick={() => toggle(s.candidate)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </EButton>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[hsl(var(--e-border))] pt-3">
            <EButton
              variant="outline"
              onClick={() => void save(false)}
              disabled={saving !== null || selected.length === 0}
            >
              <Save className="h-4 w-4" />
              {saving === "draft" ? "Saving…" : "Save draft"}
            </EButton>
            <EButton
              onClick={() => void save(true)}
              disabled={saving !== null || selected.length === 0}
            >
              <Play className="h-4 w-4" />
              {saving === "start" ? "Starting…" : "Start route"}
            </EButton>
          </div>
        </ECardBody>
      </ECard>

      {/* Candidates */}
      {errored ? (
        <EEmptyState
          eyebrow="Unavailable"
          title="Could not load routeable work"
          description="The laundry feed did not respond. Try Refresh in a moment."
        />
      ) : loading && candidates.length === 0 ? (
        <EEmptyState eyebrow="Loading" title="Fetching routeable work…" description="One moment." />
      ) : candidates.length === 0 ? (
        <EEmptyState
          eyebrow="Quiet"
          title="Nothing to route"
          description="No pickups or drop-offs are due today, tomorrow, or overdue."
        />
      ) : (
        groups.map((group) => {
          const rows = candidates.filter((c) => c.bucket === group.bucket);
          if (rows.length === 0) return null;
          return (
            <ECard key={group.bucket}>
              <ECardHeader>
                <ECardTitle>
                  <span className="inline-flex items-center gap-1.5">
                    {group.icon ?? <CalendarClock className="h-4 w-4" />}
                    {group.label}
                    <span className="e-tnum text-[0.8125rem] font-normal text-[hsl(var(--e-muted-foreground))]">
                      {rows.length}
                    </span>
                  </span>
                </ECardTitle>
              </ECardHeader>
              <ECardBody className="space-y-1.5">
                {rows.map((candidate) => (
                  <CandidateRow
                    key={keyOf(candidate)}
                    candidate={candidate}
                    selected={selectedKeys.has(keyOf(candidate))}
                    onToggle={() => toggle(candidate)}
                  />
                ))}
              </ECardBody>
            </ECard>
          );
        })
      )}
    </div>
  );
}
