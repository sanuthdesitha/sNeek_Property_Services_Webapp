"use client";

import * as React from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";

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

export function ComposeWorkspace() {
  const { toast } = useToast();
  const [templates, setTemplates] = React.useState<Template[]>([]);
  const [loadingTemplates, setLoadingTemplates] = React.useState(true);
  const [filter, setFilter] = React.useState("");
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<string | null>(null);

  // Form state
  const [channel, setChannel] = React.useState<"EMAIL" | "SMS">("EMAIL");
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");

  // Recipient
  const [recipientQuery, setRecipientQuery] = React.useState("");
  const [recipientResults, setRecipientResults] = React.useState<Recipient[]>([]);
  const [recipientSearching, setRecipientSearching] = React.useState(false);
  const [recipient, setRecipient] = React.useState<Recipient | null>(null);
  const debouncedQuery = useDebounce(recipientQuery, 250);

  // Context (variable fill sources)
  const [contextClientId, setContextClientId] = React.useState<string | undefined>();
  const [contextCleanerId, setContextCleanerId] = React.useState<string | undefined>();
  const [contextJobId, setContextJobId] = React.useState("");
  const [contextPropertyId, setContextPropertyId] = React.useState("");
  const [contextQuoteId, setContextQuoteId] = React.useState("");

  // Preview
  const [preview, setPreview] = React.useState<{ subject?: string; body: string } | null>(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);

  // Sending
  const [sending, setSending] = React.useState(false);

  // Load templates
  React.useEffect(() => {
    fetch("/api/admin/messages/templates")
      .then((r) => r.json())
      .then((data) => setTemplates(data.templates ?? []))
      .catch(() => toast({ title: "Failed to load templates", variant: "destructive" }))
      .finally(() => setLoadingTemplates(false));
  }, [toast]);

  // Recipient search
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

  // Preview re-run on changes (debounced)
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
  }, [
    debouncedBody,
    debouncedSubject,
    contextClientId,
    contextCleanerId,
    contextJobId,
    contextPropertyId,
    contextQuoteId,
  ]);

  // Group templates by category
  const filteredTemplates = React.useMemo(() => {
    const q = filter.toLowerCase().trim();
    return templates.filter(
      (t) =>
        !q ||
        t.name.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        t.body.toLowerCase().includes(q),
    );
  }, [templates, filter]);

  const grouped = React.useMemo(() => {
    const map: Record<string, Template[]> = {};
    for (const t of filteredTemplates) {
      (map[t.category] ??= []).push(t);
    }
    return map;
  }, [filteredTemplates]);

  function applyTemplate(t: Template) {
    setSelectedTemplateId(t.id);
    setSubject(t.subject ?? "");
    setBody(t.body);
    if (t.channel === "SMS") setChannel("SMS");
    else if (t.channel === "EMAIL") setChannel("EMAIL");
    // BOTH: keep current channel
  }

  function pickRecipient(r: Recipient) {
    setRecipient(r);
    setRecipientResults([]);
    setRecipientQuery(r.name);
    // Auto-fill context when picking a recipient
    if (r.kind === "client") {
      setContextClientId(r.id);
    } else {
      setContextCleanerId(r.id);
    }
  }

  function clearRecipient() {
    setRecipient(null);
    setRecipientQuery("");
  }

  async function handleSend() {
    if (!recipient) {
      toast({ title: "Choose a recipient", variant: "destructive" });
      return;
    }
    if (!body.trim()) {
      toast({ title: "Message body is empty", variant: "destructive" });
      return;
    }
    const recipientEmail = channel === "EMAIL" ? recipient.email : undefined;
    const recipientPhone = channel === "SMS" ? recipient.phone : undefined;
    if (channel === "EMAIL" && !recipientEmail) {
      toast({ title: "Recipient has no email on file", variant: "destructive" });
      return;
    }
    if (channel === "SMS" && !recipientPhone) {
      toast({ title: "Recipient has no phone on file", variant: "destructive" });
      return;
    }

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
        toast({
          title: "Send failed",
          description: data.error ?? data.status ?? "Unknown error",
          variant: "destructive",
        });
      } else {
        toast({
          title: `Sent via ${channel}`,
          description:
            channel === "EMAIL"
              ? `To ${recipientEmail}`
              : `To ${recipientPhone} via ${data.provider ?? "SMS"}`,
        });
        // Reset only message body, keep recipient for follow-ups
        setBody("");
        setSubject("");
        setSelectedTemplateId(null);
      }
    } catch (err) {
      toast({ title: "Send failed", description: String(err), variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="container max-w-7xl py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Compose Message</h1>
          <p className="text-sm text-muted-foreground">
            Pick a template, fill the variables from a client or job, and send via email or SMS.
          </p>
        </div>
        <Link href="/admin/messages" className="text-sm underline">
          Back to messages
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr_360px] gap-4">
        {/* Templates */}
        <Card className="lg:sticky lg:top-4 self-start">
          <CardHeader>
            <CardTitle className="text-base">Templates</CardTitle>
            <Input
              placeholder="Search templates…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[60vh]">
              <div className="px-3 pb-3 space-y-3">
                {loadingTemplates && (
                  <p className="text-sm text-muted-foreground">Loading…</p>
                )}
                {!loadingTemplates && filteredTemplates.length === 0 && (
                  <p className="text-sm text-muted-foreground">No templates found.</p>
                )}
                {Object.entries(grouped).map(([cat, list]) => (
                  <div key={cat}>
                    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
                      {CATEGORY_LABELS[cat] ?? cat}
                    </div>
                    <div className="space-y-1">
                      {list.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => applyTemplate(t)}
                          className={`w-full text-left rounded-md p-2 text-sm transition hover:bg-accent ${
                            selectedTemplateId === t.id ? "bg-accent" : ""
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium truncate">{t.name}</span>
                            <Badge variant="secondary" className="text-[10px]">
                              {t.channel}
                            </Badge>
                          </div>
                          <div className="text-xs text-muted-foreground truncate mt-0.5">
                            {t.subject ?? t.body.slice(0, 60)}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Composer */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Message</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Channel */}
            <div className="flex items-center gap-3">
              <Label className="w-20">Channel</Label>
              <Select value={channel} onValueChange={(v) => setChannel(v as "EMAIL" | "SMS")}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="EMAIL">Email</SelectItem>
                  <SelectItem value="SMS">SMS</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Recipient */}
            <div>
              <Label>Recipient</Label>
              {recipient ? (
                <div className="flex items-center justify-between border rounded-md p-2 mt-1">
                  <div className="text-sm">
                    <div className="font-medium">{recipient.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {recipient.kind === "client" ? "Client" : `User${recipient.role ? ` · ${recipient.role}` : ""}`}
                      {" · "}
                      {channel === "EMAIL" ? recipient.email ?? "(no email)" : recipient.phone ?? "(no phone)"}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={clearRecipient}>
                    Change
                  </Button>
                </div>
              ) : (
                <div className="relative mt-1">
                  <Input
                    placeholder="Search clients or users by name, email, or phone…"
                    value={recipientQuery}
                    onChange={(e) => setRecipientQuery(e.target.value)}
                  />
                  {recipientResults.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full max-h-72 overflow-y-auto rounded-md border bg-popover shadow-md">
                      {recipientResults.map((r) => (
                        <button
                          key={`${r.kind}:${r.id}`}
                          onClick={() => pickRecipient(r)}
                          className="block w-full text-left px-3 py-2 text-sm hover:bg-accent"
                        >
                          <div className="font-medium">{r.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {r.kind === "client" ? "Client" : `User${r.role ? ` · ${r.role}` : ""}`}
                            {r.email && ` · ${r.email}`}
                            {r.phone && ` · ${r.phone}`}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {recipientSearching && (
                    <p className="text-xs text-muted-foreground mt-1">Searching…</p>
                  )}
                </div>
              )}
            </div>

            {/* Subject (email only) */}
            {channel === "EMAIL" && (
              <div>
                <Label htmlFor="subject">Subject</Label>
                <Input
                  id="subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Subject line — supports {{variables}}"
                />
              </div>
            )}

            {/* Body */}
            <div>
              <Label htmlFor="body">Body</Label>
              <Textarea
                id="body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={channel === "SMS" ? 5 : 12}
                placeholder={
                  channel === "SMS"
                    ? "Short SMS body. Supports {{client.firstName}}, {{property.name}} …"
                    : "Email body. Supports {{client.firstName}}, {{job.scheduledFor | date short}} …"
                }
              />
              {channel === "SMS" && (
                <p className="text-xs text-muted-foreground mt-1">
                  {body.length} / 320 characters
                </p>
              )}
            </div>

            <Separator />

            {/* Context — variable fill sources */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Variable sources</Label>
              <p className="text-xs text-muted-foreground">
                IDs from the recipient picker auto-fill below. Add a job/property/quote ID to pull more variables.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="Client ID (auto)"
                  value={contextClientId ?? ""}
                  onChange={(e) => setContextClientId(e.target.value || undefined)}
                />
                <Input
                  placeholder="Cleaner ID (auto)"
                  value={contextCleanerId ?? ""}
                  onChange={(e) => setContextCleanerId(e.target.value || undefined)}
                />
                <Input
                  placeholder="Job ID"
                  value={contextJobId}
                  onChange={(e) => setContextJobId(e.target.value)}
                />
                <Input
                  placeholder="Property ID"
                  value={contextPropertyId}
                  onChange={(e) => setContextPropertyId(e.target.value)}
                />
                <Input
                  placeholder="Quote ID"
                  value={contextQuoteId}
                  onChange={(e) => setContextQuoteId(e.target.value)}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setBody("");
                  setSubject("");
                  setSelectedTemplateId(null);
                }}
                disabled={sending}
              >
                Clear
              </Button>
              <Button onClick={handleSend} disabled={sending}>
                {sending ? "Sending…" : `Send ${channel === "EMAIL" ? "Email" : "SMS"}`}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Preview */}
        <Card className="lg:sticky lg:top-4 self-start">
          <CardHeader>
            <CardTitle className="text-base">Preview</CardTitle>
            <p className="text-xs text-muted-foreground">
              Variables resolved against the selected context.
            </p>
          </CardHeader>
          <CardContent>
            {previewLoading && (
              <p className="text-sm text-muted-foreground">Resolving…</p>
            )}
            {!previewLoading && !preview && (
              <p className="text-sm text-muted-foreground">
                Type a message body to see a live preview.
              </p>
            )}
            {!previewLoading && preview && (
              <div className="space-y-2">
                {channel === "EMAIL" && preview.subject && (
                  <div>
                    <div className="text-xs text-muted-foreground">Subject</div>
                    <div className="font-medium">{preview.subject}</div>
                  </div>
                )}
                <div>
                  <div className="text-xs text-muted-foreground">Body</div>
                  <div className="whitespace-pre-wrap text-sm border rounded-md p-3 bg-muted/30">
                    {preview.body || "(empty)"}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
