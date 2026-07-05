"use client";

import { useEffect, useState } from "react";
import { Pencil, Sprout } from "lucide-react";
import { EAlert, EBadge, EButton, ECard, EEmptyState } from "@/components/v2/ui/primitives";
import {
  EField,
  EInput,
  EModal,
  ESaveStatus,
  ESectionHeading,
  ETextarea,
  EToggle,
  useSaveStatus,
} from "./estate-form";

type TemplateData = {
  eventKey: string;
  label: string;
  category: string;
  description: string | null;
  inDb: boolean;
  emailSubject: string | null;
  emailBodyText: string | null;
  smsBody: string | null;
  pushTitle: string | null;
  pushBody: string | null;
  allAvailableVars?: string[];
  variableLabels?: string[];
};

type CopyDraft = {
  emailSubject: string;
  emailBodyText: string;
  smsBody: string;
  pushTitle: string;
  pushBody: string;
};

type PreferenceData = { channel: string; role: string; enabled: boolean };

const CATEGORY_LABELS: Record<string, string> = {
  invoice: "Invoice",
  payroll: "Payroll",
  pay_adjustment: "Pay adjustments",
  client_payment: "Client payments",
  xero: "Xero",
};

const CHANNELS = ["EMAIL", "PUSH", "SMS"] as const;
const ROLES = ["ADMIN", "CLEANER", "CLIENT"] as const;

/**
 * Finance notifications — the same endpoints as the v1 workspace:
 * GET/POST /api/admin/notifications/templates (list / seed),
 * GET/POST/PATCH /api/admin/notifications/preferences (matrix toggles / bulk).
 * Template copy editing stays in the classic editor (linked below).
 */
export function FinanceNotificationsSection() {
  const [templates, setTemplates] = useState<TemplateData[]>([]);
  const [preferencesByEvent, setPreferencesByEvent] = useState<Record<string, PreferenceData[]>>({});
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Native template copy editor (same PATCH /api/admin/notifications/templates
  // endpoint as the classic editor).
  const [editing, setEditing] = useState<TemplateData | null>(null);
  const [draft, setDraft] = useState<CopyDraft>({
    emailSubject: "",
    emailBodyText: "",
    smsBody: "",
    pushTitle: "",
    pushBody: "",
  });
  const [savingCopy, setSavingCopy] = useState(false);
  const { status: copyStatus, flash: flashCopy } = useSaveStatus();

  const seeded = templates.some((t) => t.inDb);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [tplRes, prefRes] = await Promise.all([
        fetch("/api/admin/notifications/templates"),
        fetch("/api/admin/notifications/preferences"),
      ]);
      if (!tplRes.ok || !prefRes.ok) {
        setError("Failed to load notification settings.");
        return;
      }
      const tplData = await tplRes.json();
      const prefData = await prefRes.json();
      setTemplates(tplData.templates || []);
      setPreferencesByEvent(prefData.preferencesByEvent || {});
    } catch {
      setError("Failed to load notification settings.");
    } finally {
      setLoading(false);
    }
  }

  async function seed() {
    setSeeding(true);
    try {
      const res = await fetch("/api/admin/notifications/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: false }),
      });
      if (!res.ok) throw new Error();
      await load();
    } catch {
      setError("Failed to seed templates.");
    } finally {
      setSeeding(false);
    }
  }

  function prefFor(eventKey: string, role: string, channel: string): boolean {
    const prefs = preferencesByEvent[eventKey] || [];
    return prefs.find((p) => p.role === role && p.channel === channel)?.enabled ?? false;
  }

  async function togglePref(eventKey: string, role: string, channel: string, enabled: boolean) {
    // Optimistic update, mirroring v1.
    setPreferencesByEvent((prev) => {
      const prefs = [...(prev[eventKey] || [])];
      const existing = prefs.find((p) => p.role === role && p.channel === channel);
      if (existing) existing.enabled = enabled;
      else prefs.push({ role, channel, enabled });
      return { ...prev, [eventKey]: prefs };
    });
    try {
      await fetch("/api/admin/notifications/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventKey, recipientRole: role, channel, enabled }),
      });
    } catch {
      setError("Failed to update preference.");
      await load();
    }
  }

  async function bulkToggleCategory(category: string, enabled: boolean) {
    const events = templates.filter((t) => t.category === category);
    const updates = events.flatMap((event) =>
      ROLES.flatMap((role) =>
        CHANNELS.map((channel) => ({ eventKey: event.eventKey, recipientRole: role, channel, enabled }))
      )
    );
    try {
      const res = await fetch("/api/admin/notifications/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error();
      setPreferencesByEvent((prev) => {
        const next = { ...prev };
        for (const event of events) {
          next[event.eventKey] = updates
            .filter((u) => u.eventKey === event.eventKey)
            .map((u) => ({ role: u.recipientRole, channel: u.channel, enabled: u.enabled }));
        }
        return next;
      });
    } catch {
      setError("Failed to update preferences.");
    }
  }

  function openEditor(template: TemplateData) {
    setEditing(template);
    setDraft({
      emailSubject: template.emailSubject ?? "",
      emailBodyText: template.emailBodyText ?? "",
      smsBody: template.smsBody ?? "",
      pushTitle: template.pushTitle ?? "",
      pushBody: template.pushBody ?? "",
    });
  }

  function insertVariable(field: keyof CopyDraft, variable: string) {
    setDraft((prev) => ({ ...prev, [field]: `${prev[field]}{${variable}}` }));
  }

  async function saveCopy() {
    if (!editing) return;
    setSavingCopy(true);
    try {
      const res = await fetch("/api/admin/notifications/templates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventKey: editing.eventKey,
          emailSubject: draft.emailSubject || null,
          emailBodyText: draft.emailBodyText || null,
          smsBody: draft.smsBody || null,
          pushTitle: draft.pushTitle || null,
          pushBody: draft.pushBody || null,
        }),
      });
      if (!res.ok) throw new Error();
      flashCopy("saved", "Template copy saved");
      await load();
      setEditing(null);
    } catch {
      flashCopy("error", "Failed to save template copy.");
    } finally {
      setSavingCopy(false);
    }
  }

  if (loading) {
    return (
      <p className="px-1 py-12 text-center text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
        Retrieving notification settings…
      </p>
    );
  }

  const categories = Array.from(new Set(templates.map((t) => t.category)));

  return (
    <div className="space-y-6">
      <ESectionHeading
        eyebrow="Communications"
        title="Finance notifications"
        description="Which finance events reach whom, and through which channel."
        actions={
          !seeded ? (
            <EButton variant="gold" size="sm" onClick={seed} disabled={seeding}>
              <Sprout className="h-3.5 w-3.5" /> {seeding ? "Seeding…" : "Seed default templates"}
            </EButton>
          ) : undefined
        }
      />

      {error ? <EAlert tone="danger" title={error} /> : null}

      {templates.length === 0 ? (
        <EEmptyState
          eyebrow="Nothing yet"
          title="No finance notification templates"
          description="Seed the defaults to start routing invoice, payroll, and payment events."
          action={
            <EButton variant="gold" onClick={seed} disabled={seeding}>
              {seeding ? "Seeding…" : "Seed default templates"}
            </EButton>
          }
        />
      ) : (
        categories.map((category) => {
          const events = templates.filter((t) => t.category === category);
          return (
            <ECard key={category}>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--e-border))] px-6 py-4">
                <h3 className="text-[1rem] font-semibold tracking-[-0.01em]">
                  {CATEGORY_LABELS[category] ?? category}
                </h3>
                <div className="flex items-center gap-2">
                  <EButton variant="ghost" size="sm" onClick={() => bulkToggleCategory(category, true)}>
                    Enable all
                  </EButton>
                  <EButton variant="ghost" size="sm" onClick={() => bulkToggleCategory(category, false)}>
                    Disable all
                  </EButton>
                </div>
              </div>
              <div className="divide-y divide-[hsl(var(--e-border)/0.7)]">
                {events.map((event) => (
                  <div key={event.eventKey} className="px-6 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[0.875rem] font-medium">{event.label}</p>
                        {!event.inDb ? <EBadge tone="warning" soft>Not seeded</EBadge> : null}
                      </div>
                      <EButton variant="ghost" size="sm" onClick={() => openEditor(event)}>
                        <Pencil className="h-3.5 w-3.5" /> Edit copy
                      </EButton>
                    </div>
                    {event.description ? (
                      <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-text-faint))]">{event.description}</p>
                    ) : null}
                    <div className="mt-3 overflow-x-auto">
                      <table className="text-[0.8125rem]">
                        <thead>
                          <tr>
                            <th className="w-24 pr-4 text-left text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--e-muted-foreground))]" />
                            {CHANNELS.map((ch) => (
                              <th
                                key={ch}
                                className="px-4 pb-1.5 text-center text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--e-muted-foreground))]"
                              >
                                {ch}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {ROLES.map((role) => (
                            <tr key={role}>
                              <td className="pr-4 text-[0.75rem] font-medium text-[hsl(var(--e-text-secondary))]">
                                {role.charAt(0) + role.slice(1).toLowerCase()}
                              </td>
                              {CHANNELS.map((channel) => (
                                <td key={channel} className="px-4 py-1 text-center">
                                  <EToggle
                                    checked={prefFor(event.eventKey, role, channel)}
                                    onChange={(v) => togglePref(event.eventKey, role, channel, v)}
                                  />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            </ECard>
          );
        })
      )}

      <EModal
        open={editing !== null}
        onClose={() => setEditing(null)}
        eyebrow="Template copy"
        title={editing?.label ?? "Edit template"}
        wide
      >
        {editing ? (
          <div className="space-y-5">
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              Subjects, bodies and variables for this event. Leave a field blank to fall back to the default copy.
            </p>

            {editing.allAvailableVars && editing.allAvailableVars.length > 0 ? (
              <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
                <p className="text-[0.75rem] font-medium text-[hsl(var(--e-text-secondary))]">
                  Available variables — click to append to the email body
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {editing.allAvailableVars.map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => insertVariable("emailBodyText", v)}
                      className="rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border-strong))] px-2 py-1 text-[0.6875rem] font-medium text-[hsl(var(--e-text-secondary))] transition-colors hover:bg-[hsl(var(--e-muted))]"
                    >
                      {`{${v}}`}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <EField label="Email subject" htmlFor="fn-subject">
              <EInput
                id="fn-subject"
                value={draft.emailSubject}
                onChange={(e) => setDraft((prev) => ({ ...prev, emailSubject: e.target.value }))}
                placeholder="Subject line for the email"
              />
            </EField>
            <EField label="Email body" htmlFor="fn-body">
              <ETextarea
                id="fn-body"
                className="min-h-[140px]"
                value={draft.emailBodyText}
                onChange={(e) => setDraft((prev) => ({ ...prev, emailBodyText: e.target.value }))}
                placeholder="Body text — use {variables} for dynamic values"
              />
            </EField>
            <EField label="SMS body" htmlFor="fn-sms">
              <ETextarea
                id="fn-sms"
                value={draft.smsBody}
                onChange={(e) => setDraft((prev) => ({ ...prev, smsBody: e.target.value }))}
                placeholder="Short SMS text"
              />
            </EField>
            <div className="grid gap-4 sm:grid-cols-2">
              <EField label="Push title" htmlFor="fn-push-title">
                <EInput
                  id="fn-push-title"
                  value={draft.pushTitle}
                  onChange={(e) => setDraft((prev) => ({ ...prev, pushTitle: e.target.value }))}
                  placeholder="Notification title"
                />
              </EField>
              <EField label="Push body" htmlFor="fn-push-body">
                <EInput
                  id="fn-push-body"
                  value={draft.pushBody}
                  onChange={(e) => setDraft((prev) => ({ ...prev, pushBody: e.target.value }))}
                  placeholder="Notification body"
                />
              </EField>
            </div>

            <div className="flex items-center justify-end gap-3 pt-1">
              <ESaveStatus status={copyStatus} />
              <EButton variant="outline" size="sm" onClick={() => setEditing(null)} disabled={savingCopy}>
                Cancel
              </EButton>
              <EButton variant="gold" size="sm" onClick={saveCopy} disabled={savingCopy}>
                {savingCopy ? "Saving…" : "Save copy"}
              </EButton>
            </div>
          </div>
        ) : null}
      </EModal>
    </div>
  );
}
