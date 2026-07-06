"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EPageHeader,
} from "@/components/v2/ui/primitives";
import {
  EBadge,
} from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect, ETextarea } from "@/components/v2/admin/estate-kit";

type Template = {
  id: string;
  name: string;
  category: string;
  channel: "EMAIL" | "SMS" | "BOTH";
  subject?: string | null;
  body: string;
  variables?: string[] | null;
};

type Recipient = {
  id: string;
  kind: "client" | "user";
  name: string;
  email: string | null;
  phone: string | null;
  role?: string;
};

const CATEGORY_LABELS: Record<string, string> = {
  CHASE: "Chase / Follow-up",
  MARKETING: "Marketing",
  OPERATIONAL: "Operational",
  SERVICE_RECOVERY: "Service Recovery",
  FEEDBACK: "Feedback",
  COMPLAINT: "Complaint",
  ONBOARDING: "Onboarding",
  CLEANER_FACING: "Cleaner-facing",
  LAUNDRY_FACING: "Laundry-facing",
  INTERNAL: "Internal",
  CUSTOM: "Custom",
};

function useDebounce<T>(value: T, delay = 300): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

type Toast = { title: string; description?: string; tone: "success" | "danger" } | null;

export function EstateComposeWorkspace() {
  const [toast, setToast] = React.useState<Toast>(null);
  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const [templates, setTemplates] = React.useState<Template[]>([]);
  const [loadingTemplates, setLoadingTemplates] = React.useState(true);
  const [filter, setFilter] = React.useState("");
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<string | null>(null);

  const [channel, setChannel] = React.useState<"EMAIL" | "SMS">("EMAIL");
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");

  const [recipientQuery, setRecipientQuery] = React.useState("");
  const [recipientResults, setRecipientResults] = React.useState<Recipient[]>([]);
  const [recipientSearching, setRecipientSearching] = React.useState(false);
  const [recipient, setRecipient] = React.useState<Recipient | null>(null);
  const debouncedQuery = useDebounce(recipientQuery, 250);

  const [contextClientId, setContextClientId] = React.useState<string | undefined>();
  const [contextCleanerId, setContextCleanerId] = React.useState<string | undefined>();
  const [contextJobId, setContextJobId] = React.useState("");
  const [contextPropertyId, setContextPropertyId] = React.useState("");
  const [contextQuoteId, setContextQuoteId] = React.useState("");

  const [preview, setPreview] = React.useState<{ subject?: string; body: string } | null>(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [sending, setSending] = React.useState(false);

  React.useEffect(() => {
    fetch("/api/admin/messages/templates")
      .then((r) => r.json())
      .then((data) => setTemplates(data.templates ?? []))
      .catch(() => setToast({ title: "Failed to load templates", tone: "danger" }))
      .finally(() => setLoadingTemplates(false));
  }, []);

  React.useEffect(() => {
    if (!debouncedQuery || debouncedQuery.length < 2) {
      setRecipientResults([]);
      return;
    }
    setRecipientSearching(true);
    fetch(`/api/admin/messages/recipients?q=${encodeURIComponent(debouncedQuery)}`)
      .then((r) => r.json())
      .then((data) => setRecipientResults(data.recipients ?? []))
      .catch(() => setRecipientResults([]))
      .finally(() => setRecipientSearching(false));
  }, [debouncedQuery]);

  const debouncedBody = useDebounce(body, 400);
  const debouncedSubject = useDebounce(subject, 400);
  React.useEffect(() => {
    if (!debouncedBody) {
      setPreview(null);
      return;
    }
    setPreviewLoading(true);
    fetch("/api/admin/messages/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: debouncedSubject || undefined,
        body: debouncedBody,
        context: {
          clientId: contextClientId,
          cleanerId: contextCleanerId,
          jobId: contextJobId || undefined,
          propertyId: contextPropertyId || undefined,
          quoteId: contextQuoteId || undefined,
        },
      }),
    })
      .then((r) => r.json())
      .then((data) => setPreview({ subject: data.subject, body: data.body }))
      .catch(() => setPreview(null))
      .finally(() => setPreviewLoading(false));
  }, [debouncedBody, debouncedSubject, contextClientId, contextCleanerId, contextJobId, contextPropertyId, contextQuoteId]);

  const filteredTemplates = React.useMemo(() => {
    const q = filter.toLowerCase().trim();
    return templates.filter(
      (t) => !q || t.name.toLowerCase().includes(q) || t.category.toLowerCase().includes(q) || t.body.toLowerCase().includes(q)
    );
  }, [templates, filter]);

  const grouped = React.useMemo(() => {
    const map: Record<string, Template[]> = {};
    for (const t of filteredTemplates) (map[t.category] ??= []).push(t);
    return map;
  }, [filteredTemplates]);

  function applyTemplate(t: Template) {
    setSelectedTemplateId(t.id);
    setSubject(t.subject ?? "");
    setBody(t.body);
    if (t.channel === "SMS") setChannel("SMS");
    else if (t.channel === "EMAIL") setChannel("EMAIL");
  }

  function pickRecipient(r: Recipient) {
    setRecipient(r);
    setRecipientResults([]);
    setRecipientQuery(r.name);
    if (r.kind === "client") setContextClientId(r.id);
    else setContextCleanerId(r.id);
  }

  function clearRecipient() {
    setRecipient(null);
    setRecipientQuery("");
  }

  async function handleSend() {
    if (!recipient) return setToast({ title: "Choose a recipient", tone: "danger" });
    if (!body.trim()) return setToast({ title: "Message body is empty", tone: "danger" });
    const recipientEmail = channel === "EMAIL" ? recipient.email : undefined;
    const recipientPhone = channel === "SMS" ? recipient.phone : undefined;
    if (channel === "EMAIL" && !recipientEmail) return setToast({ title: "Recipient has no email on file", tone: "danger" });
    if (channel === "SMS" && !recipientPhone) return setToast({ title: "Recipient has no phone on file", tone: "danger" });

    setSending(true);
    try {
      const res = await fetch("/api/admin/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: selectedTemplateId ?? undefined,
          channel,
          recipientUserId: recipient.kind === "user" ? recipient.id : undefined,
          recipientEmail,
          recipientPhone,
          subject: subject || undefined,
          body,
          context: {
            clientId: contextClientId,
            cleanerId: contextCleanerId,
            jobId: contextJobId || undefined,
            propertyId: contextPropertyId || undefined,
            quoteId: contextQuoteId || undefined,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setToast({ title: "Send failed", description: data.error ?? data.status ?? "Unknown error", tone: "danger" });
      } else {
        setToast({
          title: `Sent via ${channel}`,
          description: channel === "EMAIL" ? `To ${recipientEmail}` : `To ${recipientPhone} via ${data.provider ?? "SMS"}`,
          tone: "success",
        });
        setBody("");
        setSubject("");
        setSelectedTemplateId(null);
      }
    } catch (err) {
      setToast({ title: "Send failed", description: String(err), tone: "danger" });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <EButton asChild variant="ghost" size="icon">
          <Link href="/v2/admin/messages" aria-label="Back to messages"><ArrowLeft className="h-4 w-4" /></Link>
        </EButton>
        <span className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Messages</span>
      </div>

      <EPageHeader
        eyebrow="Outreach"
        title="Compose message"
        description="Pick a template, fill the variables from a client or job, and send via email or SMS."
      />

      {toast ? (
        <div
          className="rounded-[var(--e-radius-lg)] border-l-[3px] p-3 text-[0.8125rem]"
          style={{
            backgroundColor: toast.tone === "danger" ? "hsl(var(--e-danger-soft))" : "hsl(var(--e-success-soft))",
            borderColor: toast.tone === "danger" ? "hsl(var(--e-danger))" : "hsl(var(--e-success))",
            color: "hsl(var(--e-foreground))",
          }}
        >
          <span className="font-semibold">{toast.title}</span>
          {toast.description ? <span className="text-[hsl(var(--e-text-secondary))]"> · {toast.description}</span> : null}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr_360px]">
        {/* Templates */}
        <ECard className="self-start lg:sticky lg:top-4">
          <ECardHeader className="gap-3 pb-3">
            <ECardTitle className="text-[0.95rem]">Templates</ECardTitle>
            <EInput placeholder="Search templates…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </ECardHeader>
          <ECardBody className="pt-0">
            <div className="max-h-[60vh] space-y-3 overflow-y-auto">
              {loadingTemplates && <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading…</p>}
              {!loadingTemplates && filteredTemplates.length === 0 && (
                <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">No templates found.</p>
              )}
              {Object.entries(grouped).map(([cat, list]) => (
                <div key={cat}>
                  <div className="mb-1 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--e-gold-ink))]">
                    {CATEGORY_LABELS[cat] ?? cat}
                  </div>
                  <div className="space-y-1">
                    {list.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => applyTemplate(t)}
                        className={`w-full rounded-[var(--e-radius)] p-2 text-left text-[0.875rem] transition-colors hover:bg-[hsl(var(--e-muted))] ${
                          selectedTemplateId === t.id ? "bg-[hsl(var(--e-primary-soft))]" : ""
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-medium text-[hsl(var(--e-foreground))]">{t.name}</span>
                          <EBadge tone="neutral" soft className="text-[0.625rem]">{t.channel}</EBadge>
                        </div>
                        <div className="mt-0.5 truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                          {t.subject ?? t.body.slice(0, 60)}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </ECardBody>
        </ECard>

        {/* Composer */}
        <ECard>
          <ECardHeader className="pb-3"><ECardTitle className="text-[0.95rem]">Message</ECardTitle></ECardHeader>
          <ECardBody className="space-y-4 pt-0">
            <EField label="Channel">
              <ESelect value={channel} onChange={(e) => setChannel(e.target.value as "EMAIL" | "SMS")} className="w-40">
                <option value="EMAIL">Email</option>
                <option value="SMS">SMS</option>
              </ESelect>
            </EField>

            {/* Recipient */}
            <div className="space-y-1.5">
              <label className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">Recipient</label>
              {recipient ? (
                <div className="flex items-center justify-between rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2">
                  <div className="text-[0.875rem]">
                    <div className="font-medium text-[hsl(var(--e-foreground))]">{recipient.name}</div>
                    <div className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      {recipient.kind === "client" ? "Client" : `User${recipient.role ? ` · ${recipient.role}` : ""}`}
                      {" · "}
                      {channel === "EMAIL" ? recipient.email ?? "(no email)" : recipient.phone ?? "(no phone)"}
                    </div>
                  </div>
                  <EButton variant="ghost" size="sm" onClick={clearRecipient}>Change</EButton>
                </div>
              ) : (
                <div className="relative">
                  <EInput
                    placeholder="Search clients or users by name, email, or phone…"
                    value={recipientQuery}
                    onChange={(e) => setRecipientQuery(e.target.value)}
                  />
                  {recipientResults.length > 0 && (
                    <div className="absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] shadow-[var(--e-elevation-3)]">
                      {recipientResults.map((r) => (
                        <button
                          key={`${r.kind}:${r.id}`}
                          onClick={() => pickRecipient(r)}
                          className="block w-full px-3 py-2 text-left text-[0.875rem] hover:bg-[hsl(var(--e-muted))]"
                        >
                          <div className="font-medium text-[hsl(var(--e-foreground))]">{r.name}</div>
                          <div className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                            {r.kind === "client" ? "Client" : `User${r.role ? ` · ${r.role}` : ""}`}
                            {r.email && ` · ${r.email}`}
                            {r.phone && ` · ${r.phone}`}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {recipientSearching && (
                    <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Searching…</p>
                  )}
                </div>
              )}
            </div>

            {channel === "EMAIL" && (
              <EField label="Subject">
                <EInput value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject line — supports {{variables}}" />
              </EField>
            )}

            <EField
              label="Body"
              hint={channel === "SMS" ? `${body.length} / 320 characters` : undefined}
            >
              <ETextarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={channel === "SMS" ? 5 : 12}
                placeholder={
                  channel === "SMS"
                    ? "Short SMS body. Supports {{client.firstName}}, {{property.name}} …"
                    : "Email body. Supports {{client.firstName}}, {{job.scheduledFor | date short}} …"
                }
              />
            </EField>

            <hr className="e-thread" />

            <div className="space-y-2">
              <label className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">Variable sources</label>
              <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">
                IDs from the recipient picker auto-fill below. Add a job/property/quote ID to pull more variables.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <EInput placeholder="Client ID (auto)" value={contextClientId ?? ""} onChange={(e) => setContextClientId(e.target.value || undefined)} />
                <EInput placeholder="Cleaner ID (auto)" value={contextCleanerId ?? ""} onChange={(e) => setContextCleanerId(e.target.value || undefined)} />
                <EInput placeholder="Job ID" value={contextJobId} onChange={(e) => setContextJobId(e.target.value)} />
                <EInput placeholder="Property ID" value={contextPropertyId} onChange={(e) => setContextPropertyId(e.target.value)} />
                <EInput placeholder="Quote ID" value={contextQuoteId} onChange={(e) => setContextQuoteId(e.target.value)} />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <EButton
                variant="outline"
                onClick={() => {
                  setBody("");
                  setSubject("");
                  setSelectedTemplateId(null);
                }}
                disabled={sending}
              >
                Clear
              </EButton>
              <EButton onClick={handleSend} disabled={sending}>
                {sending ? "Sending…" : `Send ${channel === "EMAIL" ? "Email" : "SMS"}`}
              </EButton>
            </div>
          </ECardBody>
        </ECard>

        {/* Preview */}
        <ECard className="self-start lg:sticky lg:top-4">
          <ECardHeader className="pb-3">
            <ECardTitle className="text-[0.95rem]">Preview</ECardTitle>
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Variables resolved against the selected context.</p>
          </ECardHeader>
          <ECardBody className="pt-0">
            {previewLoading && <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Resolving…</p>}
            {!previewLoading && !preview && (
              <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Type a message body to see a live preview.</p>
            )}
            {!previewLoading && preview && (
              <div className="space-y-2">
                {channel === "EMAIL" && preview.subject && (
                  <div>
                    <div className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Subject</div>
                    <div className="font-medium text-[hsl(var(--e-foreground))]">{preview.subject}</div>
                  </div>
                )}
                <div>
                  <div className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Body</div>
                  <div className="whitespace-pre-wrap rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3 text-[0.875rem] text-[hsl(var(--e-foreground))]">
                    {preview.body || "(empty)"}
                  </div>
                </div>
              </div>
            )}
          </ECardBody>
        </ECard>
      </div>
    </div>
  );
}
