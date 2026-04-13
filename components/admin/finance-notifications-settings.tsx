"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

type TemplateData = {
  eventKey: string;
  label: string;
  category: string;
  description: string | null;
  emailSubject: string | null;
  emailBodyHtml: string | null;
  emailBodyText: string | null;
  smsBody: string | null;
  pushTitle: string | null;
  pushBody: string | null;
  availableVars: string[];
  allAvailableVars: string[];
  variableLabels: string[];
  inDb: boolean;
};

type PreferenceData = {
  channel: string;
  role: string;
  enabled: boolean;
};

type PreviewData = {
  emailSubject: string;
  emailBodyText: string;
  emailBodyHtml: string;
  smsBody: string;
  pushTitle: string;
  pushBody: string;
};

const CATEGORY_LABELS: Record<string, string> = {
  invoice: "Invoice",
  payroll: "Payroll",
  pay_adjustment: "Pay Adjustments",
  client_payment: "Client Payments",
  xero: "Xero",
};

const CATEGORY_COLORS: Record<string, string> = {
  invoice: "bg-blue-100 text-blue-800",
  payroll: "bg-green-100 text-green-800",
  pay_adjustment: "bg-amber-100 text-amber-800",
  client_payment: "bg-purple-100 text-purple-800",
  xero: "bg-orange-100 text-orange-800",
};

const CHANNELS = ["EMAIL", "PUSH", "SMS"] as const;
const ROLES = ["ADMIN", "CLEANER", "CLIENT"] as const;

export function FinanceNotificationsSettings() {
  const [templates, setTemplates] = useState<TemplateData[]>([]);
  const [preferencesByEvent, setPreferencesByEvent] = useState<Record<string, PreferenceData[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seeded, setSeeded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Template editor state
  const [editingTemplate, setEditingTemplate] = useState<TemplateData | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBodyText, setEditBodyText] = useState("");
  const [editSmsBody, setEditSmsBody] = useState("");
  const [editPushTitle, setEditPushTitle] = useState("");
  const [editPushBody, setEditPushBody] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);

  // Preview state
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewTab, setPreviewTab] = useState<"email" | "sms" | "push">("email");

  // Bulk toggle state
  const [bulkToggles, setBulkToggles] = useState<Record<string, boolean>>({});

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [tplRes, prefRes] = await Promise.all([
        fetch("/api/admin/notifications/templates"),
        fetch("/api/admin/notifications/preferences"),
      ]);

      if (!tplRes.ok || !prefRes.ok) {
        setError("Failed to load notification settings");
        return;
      }

      const tplData = await tplRes.json();
      const prefData = await prefRes.json();

      setTemplates(tplData.templates || []);
      setPreferencesByEvent(prefData.preferencesByEvent || {});
      setSeeded(tplData.templates?.some((t: TemplateData) => t.inDb) ?? false);
    } catch {
      setError("Failed to load notification settings");
    } finally {
      setLoading(false);
    }
  }

  async function handleSeed() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/notifications/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: false }),
      });
      if (!res.ok) throw new Error("Failed to seed");
      await loadData();
    } catch {
      setError("Failed to seed templates");
    } finally {
      setSaving(false);
    }
  }

  async function handleTogglePreference(eventKey: string, role: string, channel: string, enabled: boolean) {
    setBulkToggles((prev) => ({ ...prev, [`${eventKey}:${role}:${channel}`]: enabled }));

    try {
      await fetch("/api/admin/notifications/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventKey, recipientRole: role, channel, enabled }),
      });

      setPreferencesByEvent((prev) => {
        const prefs = prev[eventKey] || [];
        const existing = prefs.find((p) => p.role === role && p.channel === channel);
        if (existing) {
          existing.enabled = enabled;
        } else {
          prefs.push({ role, channel, enabled });
        }
        return { ...prev, [eventKey]: [...prefs] };
      });
    } catch {
      // Revert on failure
      setBulkToggles((prev) => {
        const next = { ...prev };
        delete next[`${eventKey}:${role}:${channel}`];
        return next;
      });
    }
  }

  async function handleBulkToggleCategory(category: string, enabled: boolean) {
    const events = templates.filter((t) => t.category === category);
    const updates: Array<{ eventKey: string; recipientRole: string; channel: string; enabled: boolean }> = [];

    for (const event of events) {
      for (const role of ROLES) {
        for (const channel of CHANNELS) {
          updates.push({ eventKey: event.eventKey, recipientRole: role, channel, enabled });
        }
      }
    }

    try {
      await fetch("/api/admin/notifications/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

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
      setError("Failed to update preferences");
    }
  }

  function openTemplateEditor(template: TemplateData) {
    setEditingTemplate(template);
    setEditSubject(template.emailSubject ?? "");
    setEditBodyText(template.emailBodyText ?? "");
    setEditSmsBody(template.smsBody ?? "");
    setEditPushTitle(template.pushTitle ?? "");
    setEditPushBody(template.pushBody ?? "");
    setPreview(null);
  }

  async function saveTemplate() {
    if (!editingTemplate) return;
    setSavingTemplate(true);
    try {
      const res = await fetch("/api/admin/notifications/templates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventKey: editingTemplate.eventKey,
          emailSubject: editSubject || null,
          emailBodyText: editBodyText || null,
          smsBody: editSmsBody || null,
          pushTitle: editPushTitle || null,
          pushBody: editPushBody || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      await loadData();
      setEditingTemplate(null);
    } catch {
      setError("Failed to save template");
    } finally {
      setSavingTemplate(false);
    }
  }

  async function loadPreview() {
    if (!editingTemplate) return;
    setPreviewLoading(true);
    try {
      const res = await fetch("/api/admin/notifications/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventKey: editingTemplate.eventKey,
          variables: {
            emailSubject: editSubject,
            emailBodyText: editBodyText,
            smsBody: editSmsBody,
            pushTitle: editPushTitle,
            pushBody: editPushBody,
          },
        }),
      });
      if (!res.ok) throw new Error("Failed to preview");
      const data = await res.json();
      setPreview(data);
    } catch {
      setError("Failed to generate preview");
    } finally {
      setPreviewLoading(false);
    }
  }

  function insertVariable(field: "subject" | "body" | "sms" | "pushTitle" | "pushBody", variable: string) {
    const token = `{${variable}}`;
    if (field === "subject") setEditSubject((prev) => prev + token);
    else if (field === "body") setEditBodyText((prev) => prev + token);
    else if (field === "sms") setEditSmsBody((prev) => prev + token);
    else if (field === "pushTitle") setEditPushTitle((prev) => prev + token);
    else if (field === "pushBody") setEditPushBody((prev) => prev + token);
  }

  function isPreferenceEnabled(eventKey: string, role: string, channel: string): boolean {
    const prefs = preferencesByEvent[eventKey] || [];
    const match = prefs.find((p) => p.role === role && p.channel === channel);
    return match?.enabled ?? true; // default enabled if not set
  }

  function getEventEnabledCount(eventKey: string): number {
    let count = 0;
    for (const role of ROLES) {
      for (const channel of CHANNELS) {
        if (isPreferenceEnabled(eventKey, role, channel)) count++;
      }
    }
    return count;
  }

  const totalPossible = ROLES.length * CHANNELS.length;

  if (loading) {
    return (
      <div className="rounded-xl border px-4 py-10 text-sm text-muted-foreground">
        Loading notification settings...
      </div>
    );
  }

  if (!seeded) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Finance Notifications</CardTitle>
          <CardDescription>
            Set up notification templates and preferences for all finance events.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            No finance notification templates have been seeded yet. This will create default templates for all 34 finance events
            (invoice, payroll, pay adjustments, client payments, Xero) with sensible defaults.
          </p>
          <Button onClick={handleSeed} disabled={saving}>
            {saving ? "Seeding..." : "Seed Finance Notification Templates"}
          </Button>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </CardContent>
      </Card>
    );
  }

  const categories = Array.from(new Set(templates.map((t) => t.category)));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Finance Notifications</CardTitle>
              <CardDescription>
                Manage notification templates and channel preferences for all finance events.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={handleSeed}>
              Re-seed Defaults
            </Button>
          </div>
        </CardHeader>
      </Card>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {categories.map((category) => {
        const catTemplates = templates.filter((t) => t.category === category);
        return (
          <Card key={category}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Badge className={CATEGORY_COLORS[category] || "bg-gray-100 text-gray-800"}>
                    {CATEGORY_LABELS[category] || category}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {catTemplates.length} event{catTemplates.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-green-700"
                    onClick={() => handleBulkToggleCategory(category, true)}
                  >
                    Enable all
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-red-700"
                    onClick={() => handleBulkToggleCategory(category, false)}
                  >
                    Disable all
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {catTemplates.map((tpl) => {
                  const enabledCount = getEventEnabledCount(tpl.eventKey);
                  return (
                    <div
                      key={tpl.eventKey}
                      className="flex flex-col gap-3 rounded-lg border p-3 md:flex-row md:items-center md:justify-between"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{tpl.label}</span>
                          <Badge variant="secondary" className="text-xs">
                            {enabledCount}/{totalPossible}
                          </Badge>
                          {!tpl.inDb && (
                            <Badge variant="outline" className="text-xs">
                              Default
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          <code className="rounded bg-muted px-1">{tpl.eventKey}</code>
                        </p>
                      </div>

                      <div className="flex items-center gap-4">
                        {ROLES.map((role) => (
                          <div key={role} className="flex items-center gap-1.5">
                            <span className="text-xs font-medium text-muted-foreground">{role}</span>
                            <div className="flex items-center gap-1">
                              {CHANNELS.map((channel) => {
                                const enabled = isPreferenceEnabled(tpl.eventKey, role, channel);
                                return (
                                  <button
                                    key={channel}
                                    title={`${role} ${channel} ${enabled ? "on" : "off"}`}
                                    onClick={() =>
                                      handleTogglePreference(tpl.eventKey, role, channel, !enabled)
                                    }
                                    className={`h-6 w-6 rounded text-xs font-bold leading-none transition-colors ${
                                      enabled
                                        ? "bg-primary text-primary-foreground"
                                        : "bg-muted text-muted-foreground"
                                    }`}
                                  >
                                    {channel[0]}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>

                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        onClick={() => openTemplateEditor(tpl)}
                      >
                        Edit Template
                      </Button>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {/* Template Editor Dialog */}
      <Dialog open={!!editingTemplate} onOpenChange={(open) => !open && setEditingTemplate(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Edit Template: {editingTemplate?.label}
            </DialogTitle>
            <DialogDescription>
              Edit notification content for <code className="rounded bg-muted px-1">{editingTemplate?.eventKey}</code>.
              Use {"{variable}"} placeholders for dynamic values.
            </DialogDescription>
          </DialogHeader>

          {editingTemplate && (
            <div className="space-y-4">
              {/* Variable Picker */}
              <div>
                <p className="mb-2 text-sm font-medium">Available Variables</p>
                <div className="flex flex-wrap gap-1.5">
                  {editingTemplate.variableLabels.map((v) => (
                    <button
                      key={v}
                      onClick={() => insertVariable("body", v)}
                      className="rounded border bg-muted px-2 py-0.5 text-xs font-mono hover:bg-accent"
                      title="Click to insert into email body"
                    >
                      {"{" + v + "}"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Email Subject */}
              <div>
                <label className="mb-1 block text-sm font-medium">Email Subject</label>
                <Input
                  value={editSubject}
                  onChange={(e) => setEditSubject(e.target.value)}
                  placeholder="e.g. Invoice {invoiceNumber} generated"
                />
              </div>

              {/* Email Body */}
              <div>
                <label className="mb-1 block text-sm font-medium">Email Body (Text)</label>
                <Textarea
                  value={editBodyText}
                  onChange={(e) => setEditBodyText(e.target.value)}
                  rows={4}
                  placeholder="Email body text with {variable} placeholders"
                />
              </div>

              {/* SMS Body */}
              <div>
                <label className="mb-1 block text-sm font-medium">SMS Body</label>
                <Textarea
                  value={editSmsBody}
                  onChange={(e) => setEditSmsBody(e.target.value)}
                  rows={2}
                  placeholder="Short SMS message"
                />
              </div>

              {/* Push Notification */}
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium">Push Title</label>
                  <Input
                    value={editPushTitle}
                    onChange={(e) => setEditPushTitle(e.target.value)}
                    placeholder="Push notification title"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Push Body</label>
                  <Input
                    value={editPushBody}
                    onChange={(e) => setEditPushBody(e.target.value)}
                    placeholder="Push notification body"
                  />
                </div>
              </div>

              {/* Preview */}
              <div className="rounded-lg border p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium">Preview</p>
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      {(["email", "sms", "push"] as const).map((tab) => (
                        <button
                          key={tab}
                          onClick={() => setPreviewTab(tab)}
                          className={`rounded px-2 py-0.5 text-xs font-medium capitalize transition-colors ${
                            previewTab === tab
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {tab}
                        </button>
                      ))}
                    </div>
                    <Button size="sm" variant="outline" onClick={loadPreview} disabled={previewLoading}>
                      {previewLoading ? "Loading..." : "Preview"}
                    </Button>
                  </div>
                </div>

                {previewLoading && (
                  <p className="text-xs text-muted-foreground">Generating preview...</p>
                )}

                {preview && !previewLoading && (
                  <div className="rounded-md bg-muted p-3 text-sm">
                    {previewTab === "email" && (
                      <div>
                        <p className="mb-1 font-semibold">{preview.emailSubject}</p>
                        <p className="whitespace-pre-wrap text-muted-foreground">{preview.emailBodyText}</p>
                      </div>
                    )}
                    {previewTab === "sms" && (
                      <p className="whitespace-pre-wrap">{preview.smsBody || "No SMS body configured"}</p>
                    )}
                    {previewTab === "push" && (
                      <div>
                        <p className="font-semibold">{preview.pushTitle || "No push title"}</p>
                        <p className="text-muted-foreground">{preview.pushBody || "No push body"}</p>
                      </div>
                    )}
                  </div>
                )}

                {!preview && !previewLoading && (
                  <p className="text-xs text-muted-foreground">Click Preview to see how the template renders with sample data.</p>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setEditingTemplate(null)}>
              Cancel
            </Button>
            <Button onClick={saveTemplate} disabled={savingTemplate}>
              {savingTemplate ? "Saving..." : "Save Template"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
