"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

interface Template {
  id: string;
  name: string;
  subject: string | null;
  body: string;
  channel: string;
  category: string;
}

type Channel = "EMAIL" | "SMS" | "BOTH";
type AudienceType = "all_clients" | "inactive_clients" | "service_type";

interface Props {
  templates: Template[];
}

export default function CampaignWizard({ templates }: Props) {
  const router = useRouter();

  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState<string>("");
  const [channel, setChannel] = useState<Channel>("EMAIL");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [audienceType, setAudienceType] = useState<AudienceType>("all_clients");
  const [daysSinceLast, setDaysSinceLast] = useState<number>(60);
  const [scheduleMode, setScheduleMode] = useState<"now" | "later">("now");
  const [scheduledFor, setScheduledFor] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === templateId) ?? null,
    [templates, templateId]
  );

  function handlePickTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (t) {
      setSubject(t.subject ?? "");
      setBody(t.body);
      if (t.channel === "EMAIL" || t.channel === "SMS" || t.channel === "BOTH") {
        setChannel(t.channel as Channel);
      }
    }
  }

  async function handleSave(mode: "draft" | "schedule") {
    setError(null);
    if (!name.trim()) {
      setError("Campaign name is required");
      return;
    }
    if (!body.trim()) {
      setError("Body is required");
      return;
    }
    if (channel !== "SMS" && !subject.trim()) {
      setError("Subject is required for email");
      return;
    }
    setSaving(true);
    try {
      const audience: any = { type: audienceType };
      if (audienceType === "inactive_clients") {
        audience.filters = { daysSinceLastBooking: daysSinceLast };
      }
      const willScheduleAt = mode === "schedule" && scheduleMode === "later" && scheduledFor
        ? new Date(scheduledFor).toISOString()
        : null;

      const payload: any = {
        name,
        subject: subject || "(no subject)",
        htmlBody: body,
        audience,
        status: mode === "schedule" ? "scheduled" : "draft",
        scheduledAt: willScheduleAt,
      };

      // Use legacy /api/admin/email-campaigns; the new schema columns
      // (channel/campaignStatus/scheduledFor/templateId) are populated via a
      // follow-up PATCH so we don't expand the existing route surface.
      const res = await fetch("/api/admin/email-campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      const campaignId = data.campaign?.id;

      if (campaignId) {
        // Persist marketing-engine fields (channel, scheduledFor, templateId, campaignStatus).
        await fetch(`/api/admin/email-campaigns/${campaignId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            channel,
            campaignStatus: mode === "schedule" ? "SCHEDULED" : "DRAFT",
            scheduledFor: willScheduleAt,
            templateId: templateId || null,
          }),
        }).catch(() => null);
      }

      router.push("/admin/marketing/campaigns");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-4">
        <h2 className="mb-3 text-base font-semibold">Basics</h2>
        <div className="space-y-3">
          <div>
            <Label htmlFor="cname">Name</Label>
            <Input id="cname" value={name} onChange={(e) => setName(e.target.value)} placeholder="Spring deep clean promo" />
          </div>
          <div>
            <Label htmlFor="ctemplate">Template (optional)</Label>
            <select
              id="ctemplate"
              value={templateId}
              onChange={(e) => handlePickTemplate(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
            >
              <option value="">— None (write from scratch) —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  [{t.category}] {t.name}
                </option>
              ))}
            </select>
            {selectedTemplate ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Template channel: {selectedTemplate.channel}
              </p>
            ) : null}
          </div>
          <div>
            <Label htmlFor="cchannel">Channel</Label>
            <select
              id="cchannel"
              value={channel}
              onChange={(e) => setChannel(e.target.value as Channel)}
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
            >
              <option value="EMAIL">Email</option>
              <option value="SMS">SMS</option>
              <option value="BOTH">Both</option>
            </select>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 text-base font-semibold">Audience</h2>
        <div className="space-y-3">
          <div>
            <Label htmlFor="caud">Segment</Label>
            <select
              id="caud"
              value={audienceType}
              onChange={(e) => setAudienceType(e.target.value as AudienceType)}
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
            >
              <option value="all_clients">All active clients</option>
              <option value="inactive_clients">Inactive clients (no bookings in N days)</option>
            </select>
          </div>
          {audienceType === "inactive_clients" ? (
            <div>
              <Label htmlFor="cdays">Days since last booking</Label>
              <Input
                id="cdays"
                type="number"
                min={1}
                max={3650}
                value={daysSinceLast}
                onChange={(e) => setDaysSinceLast(Math.max(1, Number(e.target.value) || 60))}
              />
            </div>
          ) : null}
        </div>
      </Card>

      <Card className="p-4 lg:col-span-2">
        <h2 className="mb-3 text-base font-semibold">Content</h2>
        <div className="space-y-3">
          {channel !== "SMS" ? (
            <div>
              <Label htmlFor="csubject">Subject</Label>
              <Input
                id="csubject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Spring is here — 20% off deep cleans"
              />
            </div>
          ) : null}
          <div>
            <Label htmlFor="cbody">Body</Label>
            <Textarea
              id="cbody"
              rows={10}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={"Hi {{client.firstName}},\n\n…"}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Variables supported: {"{{client.firstName}}, {{client.name}}, {{property.suburb}}, …"}
            </p>
          </div>
        </div>
      </Card>

      <Card className="p-4 lg:col-span-2">
        <h2 className="mb-3 text-base font-semibold">Send</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="cmode">When</Label>
            <select
              id="cmode"
              value={scheduleMode}
              onChange={(e) => setScheduleMode(e.target.value as "now" | "later")}
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
            >
              <option value="now">Save as draft (send manually later)</option>
              <option value="later">Schedule for a future time</option>
            </select>
          </div>
          {scheduleMode === "later" ? (
            <div>
              <Label htmlFor="csched">Scheduled time</Label>
              <Input
                id="csched"
                type="datetime-local"
                value={scheduledFor}
                onChange={(e) => setScheduledFor(e.target.value)}
              />
            </div>
          ) : null}
        </div>

        {error ? (
          <div className="mt-3 rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <Button
            onClick={() => handleSave(scheduleMode === "later" ? "schedule" : "draft")}
            disabled={saving}
          >
            {saving ? "Saving…" : scheduleMode === "later" ? "Save & schedule" : "Save as draft"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
