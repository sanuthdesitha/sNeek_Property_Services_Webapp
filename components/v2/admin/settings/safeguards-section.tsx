"use client";

import { useMemo, useState } from "react";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import {
  EField,
  EInput,
  ESelectNative,
  EToggle,
  ESaveStatus,
  ESectionHeading,
  useSaveStatus,
} from "./estate-form";

/**
 * Operational safeguards — auto clock-out, SLA, recurring generation, smart
 * auto-assign, QA rework automation, cleaner-start verification, strict client
 * comms, evidence photo stamp, and recent-text suggestions. Every key mirrors
 * settings-editor.tsx and PATCHes the identical partial body.
 */
export type SafeguardsSettings = {
  cleanerStartRequireDateMatch: boolean;
  cleanerStartRequireChecklistConfirm: boolean;
  strictClientAdminOnly: boolean;
  inputHistorySuggestionsEnabled: boolean;
  autoClockOut: {
    enabled: boolean;
    stopAtEstimatedDuration: boolean;
    graceMinutes: number;
    fallbackAtMidnight: boolean;
    maxJobLengthHours: number;
  };
  sla: {
    enabled: boolean;
    warnHoursBeforeDue: number;
    overdueEscalationMinutes: number;
  };
  recurringJobs: {
    enabled: boolean;
    lookaheadDays: number;
  };
  autoAssign: {
    enabled: boolean;
    maxDailyJobsPerCleaner: number;
  };
  qaAutomation: {
    autoCreateReworkJob: boolean;
    failureThreshold: number;
    reworkDelayHours: number;
  };
  evidenceStamp: {
    dateFormat: "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD" | "DD MMM YYYY";
    timeFormat: "HH:mm" | "hh:mm a";
    showWeekday: boolean;
  };
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function SafeguardsSection({ initial, readOnly }: { initial: SafeguardsSettings; readOnly: boolean }) {
  const [form, setForm] = useState<SafeguardsSettings>(initial);
  const [saving, setSaving] = useState(false);
  const { status, flash } = useSaveStatus();

  const stampPreview = useMemo(() => {
    const { dateFormat, timeFormat, showWeekday } = form.evidenceStamp;
    const dd = "13";
    const mm = "06";
    const yyyy = "2026";
    let dateStr: string;
    switch (dateFormat) {
      case "MM/DD/YYYY":
        dateStr = `${mm}/${dd}/${yyyy}`;
        break;
      case "YYYY-MM-DD":
        dateStr = `${yyyy}-${mm}-${dd}`;
        break;
      case "DD MMM YYYY":
        dateStr = `${dd} ${MONTHS[5]} ${yyyy}`;
        break;
      default:
        dateStr = `${dd}/${mm}/${yyyy}`;
    }
    const timeStr = timeFormat === "hh:mm a" ? "3:43 pm" : "15:43";
    const weekdayStr = showWeekday ? " · Sat" : "";
    return `${timeStr} · ${dateStr}${weekdayStr}`;
  }, [form.evidenceStamp]);

  async function save() {
    if (readOnly) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cleanerStartRequireDateMatch: form.cleanerStartRequireDateMatch,
          cleanerStartRequireChecklistConfirm: form.cleanerStartRequireChecklistConfirm,
          strictClientAdminOnly: form.strictClientAdminOnly,
          inputHistorySuggestionsEnabled: form.inputHistorySuggestionsEnabled,
          autoClockOut: form.autoClockOut,
          sla: form.sla,
          recurringJobs: form.recurringJobs,
          autoAssign: form.autoAssign,
          qaAutomation: form.qaAutomation,
          evidenceStamp: form.evidenceStamp,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        flash("error", body.error ?? "Could not save settings.");
        return;
      }
      flash("saved", "Settings saved");
    } catch {
      flash("error", "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <ESectionHeading
        eyebrow="Operations"
        title="Operational safeguards"
        description="Time-tracking, SLA escalation, recurring generation, smart assignment, and QA rework automation."
      />

      {/* Cleaner start + client comms */}
      <ECard className="p-6">
        <div className="space-y-4">
          <EToggle
            checked={form.cleanerStartRequireDateMatch}
            onChange={(v) => setForm((p) => ({ ...p, cleanerStartRequireDateMatch: v }))}
            disabled={readOnly}
            label="Cleaner start date verification"
            description="Cleaner must verify the scheduled date when starting a job."
          />
          <EToggle
            checked={form.cleanerStartRequireChecklistConfirm}
            onChange={(v) => setForm((p) => ({ ...p, cleanerStartRequireChecklistConfirm: v }))}
            disabled={readOnly}
            label="Cleaner start checklist verification"
            description="Cleaner must confirm on-site readiness before start."
          />
          <EToggle
            checked={form.strictClientAdminOnly}
            onChange={(v) => setForm((p) => ({ ...p, strictClientAdminOnly: v }))}
            disabled={readOnly}
            label="Client communication requires admin initiation"
            description="Blocks automatic client messaging; only admin-initiated share actions can send."
          />
          <EToggle
            checked={form.inputHistorySuggestionsEnabled}
            onChange={(v) => setForm((p) => ({ ...p, inputHistorySuggestionsEnabled: v }))}
            disabled={readOnly}
            label="Recent-text suggestions"
            description="The “recently typed” dropdown on text fields (same-session history). Always off on login/sign-up pages."
          />
        </div>
      </ECard>

      {/* Auto clock-out */}
      <ECard className="p-6">
        <div className="space-y-4">
          <EToggle
            checked={form.autoClockOut.enabled}
            onChange={(v) => setForm((p) => ({ ...p, autoClockOut: { ...p.autoClockOut, enabled: v } }))}
            disabled={readOnly}
            label="Auto clock-out enabled"
            description="Automatically stop running time logs after the configured grace period."
          />
          <EToggle
            checked={form.autoClockOut.stopAtEstimatedDuration}
            onChange={(v) =>
              setForm((p) => ({ ...p, autoClockOut: { ...p.autoClockOut, stopAtEstimatedDuration: v } }))
            }
            disabled={readOnly}
            label="Stop timer at the job's estimated duration"
            description="Off by default. Turn on to auto clock-out when the estimated hours are used up."
          />
          <EToggle
            checked={form.autoClockOut.fallbackAtMidnight}
            onChange={(v) =>
              setForm((p) => ({ ...p, autoClockOut: { ...p.autoClockOut, fallbackAtMidnight: v } }))
            }
            disabled={readOnly}
            label="Fallback auto clock-out at midnight"
            description="Safety net when a job has no due or end time."
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <EField label="Grace minutes after due time" hint="Timers auto-stop this many minutes after the job's due/end time.">
              <EInput
                type="number"
                min={0}
                max={240}
                value={form.autoClockOut.graceMinutes}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    autoClockOut: { ...p.autoClockOut, graceMinutes: Number(e.target.value || p.autoClockOut.graceMinutes) },
                  }))
                }
                disabled={readOnly}
              />
            </EField>
            <EField label="Maximum job length (hours)" hint="Used when a job does not have fixed / allocated pay hours set.">
              <EInput
                type="number"
                min={1}
                max={24}
                value={form.autoClockOut.maxJobLengthHours}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    autoClockOut: {
                      ...p.autoClockOut,
                      maxJobLengthHours: Number(e.target.value || p.autoClockOut.maxJobLengthHours),
                    },
                  }))
                }
                disabled={readOnly}
              />
            </EField>
          </div>
        </div>
      </ECard>

      {/* SLA + recurring + auto-assign + QA */}
      <div className="grid gap-6 lg:grid-cols-2">
        <ECard className="p-6">
          <div className="space-y-4">
            <EToggle
              checked={form.sla.enabled}
              onChange={(v) => setForm((p) => ({ ...p, sla: { ...p.sla, enabled: v } }))}
              disabled={readOnly}
              label="SLA monitoring enabled"
            />
            <div className="grid gap-5 sm:grid-cols-2">
              <EField label="Warn before due (hours)">
                <EInput
                  type="number"
                  min={1}
                  max={72}
                  value={form.sla.warnHoursBeforeDue}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, sla: { ...p.sla, warnHoursBeforeDue: Number(e.target.value || p.sla.warnHoursBeforeDue) } }))
                  }
                  disabled={readOnly}
                />
              </EField>
              <EField label="Escalate overdue after (mins)">
                <EInput
                  type="number"
                  min={5}
                  max={1440}
                  value={form.sla.overdueEscalationMinutes}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      sla: { ...p.sla, overdueEscalationMinutes: Number(e.target.value || p.sla.overdueEscalationMinutes) },
                    }))
                  }
                  disabled={readOnly}
                />
              </EField>
            </div>
          </div>
        </ECard>

        <ECard className="p-6">
          <div className="space-y-4">
            <EToggle
              checked={form.recurringJobs.enabled}
              onChange={(v) => setForm((p) => ({ ...p, recurringJobs: { ...p.recurringJobs, enabled: v } }))}
              disabled={readOnly}
              label="Recurring generation enabled"
            />
            <EField label="Lookahead days">
              <EInput
                type="number"
                min={1}
                max={60}
                value={form.recurringJobs.lookaheadDays}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    recurringJobs: { ...p.recurringJobs, lookaheadDays: Number(e.target.value || p.recurringJobs.lookaheadDays) },
                  }))
                }
                disabled={readOnly}
              />
            </EField>
          </div>
        </ECard>

        <ECard className="p-6">
          <div className="space-y-4">
            <EToggle
              checked={form.autoAssign.enabled}
              onChange={(v) => setForm((p) => ({ ...p, autoAssign: { ...p.autoAssign, enabled: v } }))}
              disabled={readOnly}
              label="Smart auto-assign enabled"
            />
            <EField label="Max daily jobs per cleaner">
              <EInput
                type="number"
                min={1}
                max={20}
                value={form.autoAssign.maxDailyJobsPerCleaner}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    autoAssign: {
                      ...p.autoAssign,
                      maxDailyJobsPerCleaner: Number(e.target.value || p.autoAssign.maxDailyJobsPerCleaner),
                    },
                  }))
                }
                disabled={readOnly}
              />
            </EField>
          </div>
        </ECard>

        <ECard className="p-6">
          <div className="space-y-4">
            <EToggle
              checked={form.qaAutomation.autoCreateReworkJob}
              onChange={(v) => setForm((p) => ({ ...p, qaAutomation: { ...p.qaAutomation, autoCreateReworkJob: v } }))}
              disabled={readOnly}
              label="Auto-create rework on QA fail"
            />
            <div className="grid gap-5 sm:grid-cols-2">
              <EField label="QA fail threshold">
                <EInput
                  type="number"
                  min={0}
                  max={100}
                  value={form.qaAutomation.failureThreshold}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      qaAutomation: { ...p.qaAutomation, failureThreshold: Number(e.target.value || p.qaAutomation.failureThreshold) },
                    }))
                  }
                  disabled={readOnly}
                />
              </EField>
              <EField label="Rework delay (hours)">
                <EInput
                  type="number"
                  min={1}
                  max={168}
                  value={form.qaAutomation.reworkDelayHours}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      qaAutomation: { ...p.qaAutomation, reworkDelayHours: Number(e.target.value || p.qaAutomation.reworkDelayHours) },
                    }))
                  }
                  disabled={readOnly}
                />
              </EField>
            </div>
          </div>
        </ECard>
      </div>

      {/* Evidence photo stamp */}
      <ECard className="p-6">
        <div className="space-y-4">
          <div>
            <p className="text-[0.875rem] font-medium">Evidence photo stamp</p>
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              Timestamp format burned into every job / QA / maintenance photo. Preview:{" "}
              <span className="font-medium text-[hsl(var(--e-foreground))]">{stampPreview}</span>
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <EField label="Date format">
              <ESelectNative
                value={form.evidenceStamp.dateFormat}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    evidenceStamp: { ...p.evidenceStamp, dateFormat: e.target.value as SafeguardsSettings["evidenceStamp"]["dateFormat"] },
                  }))
                }
                disabled={readOnly}
              >
                <option value="DD/MM/YYYY">DD/MM/YYYY (13/06/2026)</option>
                <option value="MM/DD/YYYY">MM/DD/YYYY (06/13/2026)</option>
                <option value="YYYY-MM-DD">YYYY-MM-DD (2026-06-13)</option>
                <option value="DD MMM YYYY">DD MMM YYYY (13 Jun 2026)</option>
              </ESelectNative>
            </EField>
            <EField label="Time format">
              <ESelectNative
                value={form.evidenceStamp.timeFormat}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    evidenceStamp: { ...p.evidenceStamp, timeFormat: e.target.value as SafeguardsSettings["evidenceStamp"]["timeFormat"] },
                  }))
                }
                disabled={readOnly}
              >
                <option value="HH:mm">24-hour (15:43)</option>
                <option value="hh:mm a">12-hour (3:43 pm)</option>
              </ESelectNative>
            </EField>
          </div>
          <EToggle
            checked={form.evidenceStamp.showWeekday}
            onChange={(v) => setForm((p) => ({ ...p, evidenceStamp: { ...p.evidenceStamp, showWeekday: v } }))}
            disabled={readOnly}
            label="Show weekday"
            description="Adds the day name (e.g. Sat) under the date."
          />
        </div>
      </ECard>

      <div className="flex items-center justify-end gap-3">
        <ESaveStatus status={status} />
        {!readOnly ? (
          <EButton onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </EButton>
        ) : (
          <p className="text-[0.8125rem] text-[hsl(var(--e-text-faint))]">Read-only — administrator access required to edit.</p>
        )}
      </div>
    </div>
  );
}
