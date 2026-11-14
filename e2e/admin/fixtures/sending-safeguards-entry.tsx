import React from "react";
import { createRoot } from "react-dom/client";
import { EPageHeader } from "@/components/v2/ui/primitives";
import { SafeguardsScreen } from "@/components/v2/admin/notifications/safeguards/safeguards-screen";
import { DEFAULT_SAFEGUARD_SETTINGS } from "@/lib/notifications/safeguards/config";
import type { SafeguardsResponse } from "@/lib/notifications/safeguards/overview-types";

const mode = new URLSearchParams(location.search).get("mode") === "dark" ? "dark" : "light";
const canManage = new URLSearchParams(location.search).get("role") !== "ops";

const initial: SafeguardsResponse = {
  generatedAt: "2026-11-15T01:00:00.000Z", timeZone: "Australia/Sydney", since: "2026-11-14T13:00:00.000Z",
  settings: DEFAULT_SAFEGUARD_SETTINGS,
  volumes: [
    { typeKey: "job.qa_and_accountability", typeName: "QA result, rework and coaching notices with a long name that wraps", transport: "EMAIL", sent: 12, notSent: 30, held: 1 },
    { typeKey: "job.cleaner_day_reminder", typeName: "Cleaner day-before reminder", transport: "MOBILE_PUSH", sent: 41, notSent: 0, held: 0 },
    { typeKey: "office.sla_and_summaries", typeName: "SLA breaches, attention summary, briefing and tomorrow prep", transport: "SMS", sent: 18, notSent: 4, held: 0 },
  ],
  topRecipients: [{ recipient: "Anastasia Long-Surname-Cleaner", transport: "EMAIL", sent: 12 }, { recipient: "o***@example.com", transport: "SMS", sent: 5 }],
  suppressedByReason: [{ reason: "PAUSED_RECIPIENT", label: "sending to this person is paused", count: 30 }, { reason: "QUIET_HOURS", label: "quiet hours (dropped; the inbox copy remains)", count: 4 }],
  recentNotSent: [{ id: "e1", createdAt: "2026-11-15T00:30:00.000Z", transport: "EMAIL", typeName: "QA result, rework and coaching notices", recipient: "Anastasia Long-Surname-Cleaner", reason: "PAUSED_RECIPIENT", label: "sending to this person is paused", held: false, subject: "QA needs attention (40%) — 14 Harbourview Terrace, Kirribilli" }],
  paused: [{ id: "i1", kind: "BREAKER", scopeKind: "RECIPIENT", scopeLabel: "Anastasia Long-Surname-Cleaner", label: "Anastasia Long-Surname-Cleaner", status: "ACTIVE", pausesSending: true, attempts: 42, recipients: ["a***@example.com"], transport: "EMAIL", windowMinutes: 15, threshold: 12, note: null, createdAt: "2026-11-15T00:10:00.000Z", resolvedAt: null, alertedAt: "2026-11-15T00:10:01.000Z", resolutionNote: null }],
  incidents: [{ id: "i2", kind: "WORKER_FAILING", scopeKind: "JOB_NAME", scopeLabel: "tomorrow-prep-dispatch", label: "Scheduled job: tomorrow-prep-dispatch", status: "RESOLVED", pausesSending: false, attempts: 3, recipients: [], transport: null, windowMinutes: null, threshold: null, note: "Error: connect ECONNREFUSED", createdAt: "2026-11-14T08:00:00.000Z", resolvedAt: "2026-11-14T10:00:00.000Z", alertedAt: "2026-11-14T08:00:01.000Z", resolutionNote: "The job succeeded again." }],
  pausableTypes: [{ key: "job.qa_and_accountability", name: "QA result, rework and coaching notices" }, { key: "job.cleaner_invoice", name: "Cleaner invoice notices" }],
  canManage, readOnlyReason: canManage ? null : "Only an administrator can change the sending safeguards.",
};

createRoot(document.getElementById("root")!).render(
  <div className={mode === "dark" ? "dark" : ""}>
    <main data-skin="estate" data-mode={mode} style={{ minHeight: "100vh", background: "hsl(var(--e-background))" }} className="px-4 py-4 sm:px-6">
      <div className="mx-auto max-w-[1200px] space-y-6">
        <EPageHeader eyebrow="Notifications" title="Sending safeguards" description="Limits on how often one person can be emailed, texted or pushed, automatic pauses when something loops, and the emergency stop." />
        <SafeguardsScreen initial={initial} timeZone="Australia/Sydney" />
      </div>
    </main>
  </div>,
);
