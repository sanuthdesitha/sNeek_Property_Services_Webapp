"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Mail, MessageSquare, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { EmailDesigner } from "@/components/admin/templates/email-designer";
import { parseEmailHtml, renderEmailHtml, type EmailDesign } from "@/lib/templates/email-blocks";

type Template = {
  eventKey: string;
  label: string;
  category: string;
  emailSubject: string | null;
  emailBodyHtml: string | null;
  emailBodyText: string | null;
  smsBody: string | null;
  allAvailableVars: string[];
};

export function EmailTemplatesWorkspace() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [design, setDesign] = useState<EmailDesign | null>(null);
  const [sms, setSms] = useState("");

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/notifications/templates");
      if (res.ok) {
        const data = await res.json();
        const list: Template[] = data.templates || [];
        setTemplates(list);
        if (list.length && !activeKey) selectTemplate(list[0]);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  function selectTemplate(t: Template) {
    setActiveKey(t.eventKey);
    setSubject(t.emailSubject ?? "");
    setDesign(parseEmailHtml(t.emailBodyHtml));
    setSms(t.smsBody ?? "");
  }

  const active = templates.find((t) => t.eventKey === activeKey) ?? null;
  const variables = active?.allAvailableVars ?? [];
  const grouped = useMemo(() => {
    const map = new Map<string, Template[]>();
    for (const t of templates) {
      const arr = map.get(t.category) ?? [];
      arr.push(t);
      map.set(t.category, arr);
    }
    return Array.from(map.entries());
  }, [templates]);

  const smsSegments = Math.max(1, Math.ceil((sms.length || 1) / 160));

  async function save() {
    if (!active || !design) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/notifications/templates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventKey: active.eventKey,
          emailSubject: subject,
          emailBodyHtml: renderEmailHtml(design),
          smsBody: sms,
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        toast({ title: "Save failed", description: e.error, variant: "destructive" });
        return;
      }
      toast({ title: "Template saved" });
      // Reflect saved values back into the in-memory list.
      setTemplates((prev) =>
        prev.map((t) =>
          t.eventKey === active.eventKey
            ? { ...t, emailSubject: subject, emailBodyHtml: renderEmailHtml(design), smsBody: sms }
            : t,
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border px-4 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading templates…
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      {/* Template picker */}
      <div className="space-y-3 lg:max-h-[80vh] lg:overflow-y-auto lg:pr-1">
        {grouped.map(([category, list]) => (
          <div key={category}>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{category}</p>
            <div className="space-y-1">
              {list.map((t) => (
                <button
                  key={t.eventKey}
                  onClick={() => selectTemplate(t)}
                  className={`w-full truncate rounded-md border px-2.5 py-2 text-left text-sm transition ${
                    t.eventKey === activeKey ? "border-primary bg-primary/5" : "hover:bg-muted/40"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Editor */}
      {active && design ? (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold">{active.label}</h2>
              <p className="text-xs text-muted-foreground">Event: <code>{active.eventKey}</code></p>
            </div>
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
              Save template
            </Button>
          </div>

          <section className="space-y-3 rounded-xl border p-4">
            <div className="flex items-center gap-2 text-sm font-semibold"><Mail className="h-4 w-4" /> Email</div>
            <div className="space-y-1">
              <Label className="text-sm">Subject</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Email subject (you can use {{variables}})" />
            </div>
            <EmailDesigner design={design} onChange={setDesign} variables={variables} />
          </section>

          <section className="space-y-2 rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold"><MessageSquare className="h-4 w-4" /> SMS</div>
              <Badge variant="secondary" className="text-[11px]">{sms.length} chars · {smsSegments} segment{smsSegments > 1 ? "s" : ""}</Badge>
            </div>
            <Textarea value={sms} onChange={(e) => setSms(e.target.value)} rows={3} placeholder="SMS text (keep it short; {{variables}} supported)" />
            <div className="flex flex-wrap gap-1">
              {variables.map((v) => (
                <button key={v} onClick={() => setSms((s) => `${s}{{${v}}}`)} className="rounded-full border bg-muted/40 px-2 py-0.5 font-mono text-[11px] hover:border-primary/50">
                  {v}
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : (
        <div className="rounded-xl border px-4 py-10 text-sm text-muted-foreground">Select a template to edit.</div>
      )}
    </div>
  );
}
