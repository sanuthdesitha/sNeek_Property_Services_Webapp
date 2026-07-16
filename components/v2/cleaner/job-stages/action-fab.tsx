"use client";

/**
 * Floating "+" action button (stages 2–5, while unlocked). Opens a bottom sheet
 * of quick actions. Each row renders the EXISTING JobActions body standalone
 * (embedded mode) or routes to the right place — nothing here re-implements a
 * request flow.
 */
import * as React from "react";
import {
  Plus,
  X,
  ChevronLeft,
  AlertTriangle,
  Wrench,
  DollarSign,
  CalendarClock,
  WashingMachine,
  ShieldCheck,
  PackageSearch,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DamageReport,
  ExtraPayRequest,
  ContinuationRequest,
} from "@/components/v2/cleaner/job-actions";
import { ReportMaintenance } from "@/components/v2/cleaner/report-maintenance";
import { SafetyCheckin } from "@/components/v2/cleaner/job-actions";
import { LostFoundForm } from "@/components/v2/cleaner/lost-found-form";
import type { WorkspaceApi } from "@/components/v2/cleaner/job-stages/shared";

type ActionKey =
  | "damage"
  | "maintenance"
  | "pay"
  | "continuation"
  | "laundry"
  | "safety"
  | "lostfound";

interface Row {
  key: ActionKey;
  label: string;
  icon: React.ReactNode;
  show: boolean;
}

export function ActionFab({ api }: { api: WorkspaceApi }) {
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState<ActionKey | null>(null);

  const visible = !api.locked && !api.needsAcceptance && api.activeStage >= 2;
  if (!visible) return null;

  const isAirbnb = String(api.job?.jobType ?? "") === "AIRBNB_TURNOVER";
  const requiresSafety = Boolean(api.job?.requiresSafetyCheckin);

  const allRows: Row[] = [
    { key: "damage", label: "Report damage", icon: <AlertTriangle className="h-4 w-4 text-[hsl(var(--e-warning))]" />, show: true },
    { key: "maintenance", label: "Maintenance issue", icon: <Wrench className="h-4 w-4" />, show: isAirbnb },
    { key: "pay", label: "Extra pay request", icon: <DollarSign className="h-4 w-4" />, show: true },
    { key: "continuation", label: "Pause / continue request", icon: <CalendarClock className="h-4 w-4" />, show: true },
    { key: "laundry", label: "Early laundry update", icon: <WashingMachine className="h-4 w-4" />, show: api.laundryEnabled },
    { key: "safety", label: "Safety check-in", icon: <ShieldCheck className="h-4 w-4" />, show: requiresSafety },
    { key: "lostfound", label: "Lost & found", icon: <PackageSearch className="h-4 w-4" />, show: true },
  ];
  const rows = allRows.filter((r) => r.show);

  function close() {
    setOpen(false);
    setActive(null);
  }

  function choose(key: ActionKey) {
    if (key === "laundry") {
      // Early laundry update lives in the Wrap up laundry card.
      api.setActiveStage(5);
      close();
      setTimeout(() => {
        document.getElementById("wrapup-laundry")?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 80);
      return;
    }
    setActive(key);
  }

  const activeRow = rows.find((r) => r.key === active) ?? null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Quick actions"
        className="fixed bottom-20 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-[hsl(var(--e-gold))] text-[hsl(var(--e-gold-foreground))] shadow-[var(--e-elevation-gold)] transition-transform active:scale-95 lg:bottom-8 lg:right-8"
      >
        <Plus className="h-6 w-6" />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
          <div className="fixed inset-0 bg-[hsl(160_18%_8%/0.45)] backdrop-blur-[2px]" onClick={close} />
          <div className="e-rise relative z-10 max-h-[85vh] w-full overflow-y-auto rounded-t-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4 shadow-[var(--e-elevation-3)] sm:mx-4 sm:max-w-lg sm:rounded-[var(--e-radius-lg)]">
            <div className="mb-3 flex items-center justify-between gap-2">
              {active ? (
                <button
                  type="button"
                  onClick={() => setActive(null)}
                  className="inline-flex items-center gap-1 text-[0.8125rem] font-[550] text-[hsl(var(--e-muted-foreground))]"
                >
                  <ChevronLeft className="h-4 w-4" /> Back
                </button>
              ) : (
                <p className="e-eyebrow">Quick actions</p>
              )}
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-[hsl(var(--e-border))] text-[hsl(var(--e-muted-foreground))] hover:bg-[hsl(var(--e-muted))]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {!active ? (
              <div className="space-y-1.5">
                {rows.map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => choose(r.key)}
                    className="flex w-full items-center gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 py-3 text-left text-[0.9375rem] font-[550] transition-colors hover:bg-[hsl(var(--e-muted))]"
                  >
                    {r.icon}
                    {r.label}
                  </button>
                ))}
              </div>
            ) : (
              <div>
                <p className="mb-3 text-[0.9375rem] font-[600]">{activeRow?.label}</p>
                <ActionBody api={api} action={active} onDone={() => api.load()} />
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

function ActionBody({
  api,
  action,
  onDone,
}: {
  api: WorkspaceApi;
  action: ActionKey;
  onDone: () => void;
}) {
  const jobId = api.jobId;
  switch (action) {
    case "damage":
      return <DamageReport jobId={jobId} onChanged={onDone} embedded />;
    case "maintenance":
      return <ReportMaintenance jobId={jobId} onChanged={onDone} />;
    case "pay":
      return <ExtraPayRequest jobId={jobId} onChanged={onDone} embedded />;
    case "continuation":
      return <ContinuationRequest jobId={jobId} hasStarted={api.hasStarted} onChanged={onDone} embedded />;
    case "safety":
      return (
        <SafetyCheckin
          jobId={jobId}
          safetyCheckinAt={api.job?.safetyCheckinAt ?? null}
          onChanged={onDone}
          embedded
        />
      );
    case "lostfound":
      return <LostFoundForm jobs={[{ id: jobId, label: api.propertyCode || api.addressLine || "This job" }]} />;
    default:
      return null;
  }
}
