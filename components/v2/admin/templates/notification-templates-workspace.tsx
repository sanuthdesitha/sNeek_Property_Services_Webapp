"use client";

/**
 * Estate notification/email template designer.
 *
 * Lists every FINANCE notification event key (via GET /api/admin/notifications/templates,
 * the same source v1 uses) with a customised/default status, searchable. Editing opens a
 * wide Estate modal with:
 *   - emailSubject (with variable chips)
 *   - emailBodyHtml  → block-based rich designer (EstateEmailDesigner) + live preview
 *   - emailBodyText  → plain-text fallback (with variable chips)
 *   - smsBody        → textarea + segment count + SMS preview
 * Saves via PATCH { eventKey, emailSubject, emailBodyHtml, emailBodyText, smsBody } — the
 * exact body shape the v1 workspace posts. "Reset to default" PATCHes the overridable
 * fields back to null so the endpoint falls back to the file-based defaults.
 */

import * as React from "react";
import { Loader2, Mail, MessageSquare, Search, Save, RotateCcw } from "lucide-react";
import {
  parseEmailHtml,
  renderEmailHtml,
  type EmailDesign,
} from "@/lib/templates/email-blocks";
import { EBadge, EButton, EEmptyState } from "@/components/v2/ui/primitives";
import {
  EField,
  EInput,
  EModal,
  ETableShell,
  ETextarea,
} from "@/components/v2/admin/estate-kit";
import {
  EstateEmailDesigner,
  VariableChips,
} from "@/components/v2/admin/templates/estate-email-designer";

type Template = {
  eventKey: string;
  label: string;
  category: string;
  emailSubject: string | null;
  emailBodyHtml: string | null;
  emailBodyText: string | null;
  smsBody: string | null;
  allAvailableVars: string[];
  inDb: boolean;
};

const CATEGORY_LABEL: Record<string, string> = {
  invoice: "Invoice",
  payroll: "Payroll",
  pay_adjustment: "Pay adjustment",
  client_payment: "Client payment",
  xero: "Xero",
};

export function NotificationTemplatesWorkspace() {
  const [templates, setTemplates] = React.useState<Template[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [query, setQuery] = React.useState("");
  const [editing, setEditing] = React.useState<Template | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/notifications/templates");
      if (res.ok) {
        const data = await res.json();
        setTemplates((data.templates as Template[]) ?? []);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(
      (t) =>
        t.label.toLowerCase().includes(q) ||
        t.eventKey.toLowerCase().includes(q) ||
        (CATEGORY_LABEL[t.category] ?? t.category).toLowerCase().includes(q)
    );
  }, [templates, query]);

  function handleSaved(next: Template) {
    setTemplates((prev) =>
      prev.map((t) => (t.eventKey === next.eventKey ? next : t))
    );
    setEditing(null);
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] px-4 py-10 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading templates…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--e-text-faint))]" />
        <EInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search templates…"
          className="pl-9"
        />
      </div>

      <div className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
        <ETableShell
          headers={[
            { label: "Template" },
            { label: "Category" },
            { label: "Status" },
            { label: "", align: "right" },
          ]}
        >
          {filtered.map((t) => (
            <tr
              key={t.eventKey}
              className="cursor-pointer transition-colors hover:bg-[hsl(var(--e-muted)/0.4)]"
              onClick={() => setEditing(t)}
            >
              <td className="px-4 py-3">
                <div className="font-[550] text-[hsl(var(--e-foreground))]">
                  {t.label}
                </div>
                <div className="font-mono text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                  {t.eventKey}
                </div>
              </td>
              <td className="px-4 py-3 text-[hsl(var(--e-text-secondary))]">
                {CATEGORY_LABEL[t.category] ?? t.category}
              </td>
              <td className="px-4 py-3">
                {t.inDb ? (
                  <EBadge tone="gold" soft>
                    Customised
                  </EBadge>
                ) : (
                  <EBadge tone="neutral" soft>
                    Default
                  </EBadge>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                <EButton
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(t);
                  }}
                >
                  Edit
                </EButton>
              </td>
            </tr>
          ))}
        </ETableShell>

        {filtered.length === 0 ? (
          <div className="p-6">
            <EEmptyState
              eyebrow="Templates"
              title="No matching templates"
              description="Try a different search term."
            />
          </div>
        ) : null}
      </div>

      {editing ? (
        <NotificationEditor
          template={editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      ) : null}
    </div>
  );
}

function NotificationEditor({
  template,
  onClose,
  onSaved,
}: {
  template: Template;
  onClose: () => void;
  onSaved: (next: Template) => void;
}) {
  const [subject, setSubject] = React.useState(template.emailSubject ?? "");
  const [design, setDesign] = React.useState<EmailDesign>(() =>
    parseEmailHtml(template.emailBodyHtml)
  );
  const [bodyText, setBodyText] = React.useState(template.emailBodyText ?? "");
  const [sms, setSms] = React.useState(template.smsBody ?? "");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const subjectRef = React.useRef<HTMLInputElement>(null);

  const variables = template.allAvailableVars ?? [];
  const smsSegments = Math.max(1, Math.ceil((sms.length || 1) / 160));

  /** Insert a token at the caret of the (ref-forwarding) subject input. */
  function insertAtCaret(
    ref: React.RefObject<HTMLInputElement>,
    value: string,
    setValue: (v: string) => void,
    token: string
  ) {
    const el = ref.current;
    const insert = `{{${token}}}`;
    if (!el) {
      setValue(`${value}${insert}`);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + insert + value.slice(end);
    setValue(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + insert.length;
      el.setSelectionRange(pos, pos);
    });
  }

  /** Textareas (ETextarea isn't ref-forwarding) → append the token. */
  function appendToken(
    value: string,
    setValue: (v: string) => void,
    token: string
  ) {
    setValue(`${value}{{${token}}}`);
  }

  async function persist(body: {
    emailSubject: string | null;
    emailBodyHtml: string | null;
    emailBodyText: string | null;
    smsBody: string | null;
  }) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/notifications/templates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventKey: template.eventKey, ...body }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setError(e.error ?? "Save failed.");
        return;
      }
      onSaved({
        ...template,
        emailSubject: body.emailSubject,
        emailBodyHtml: body.emailBodyHtml,
        emailBodyText: body.emailBodyText,
        smsBody: body.smsBody,
        inDb: true,
      });
    } catch {
      setError("Network error while saving.");
    } finally {
      setSaving(false);
    }
  }

  function save() {
    void persist({
      emailSubject: subject,
      emailBodyHtml: renderEmailHtml(design),
      emailBodyText: bodyText || null,
      smsBody: sms || null,
    });
  }

  async function resetToDefault() {
    // Clearing the overridable fields makes the GET endpoint fall back to the
    // file-based defaults for this event key.
    await persist({
      emailSubject: null,
      emailBodyHtml: null,
      emailBodyText: null,
      smsBody: null,
    });
  }

  const smsPreview = fillSampleText(sms, variables);

  return (
    <EModal
      open
      onClose={onClose}
      wide
      eyebrow={`Event · ${template.eventKey}`}
      title={template.label}
    >
      <div className="space-y-6">
        {error ? (
          <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-danger)/0.4)] bg-[hsl(var(--e-danger)/0.08)] px-3 py-2 text-[0.8125rem] text-[hsl(var(--e-danger))]">
            {error}
          </div>
        ) : null}

        {/* Email subject */}
        <section className="space-y-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] p-4">
          <div className="flex items-center gap-2 text-[0.8125rem] font-[600] text-[hsl(var(--e-foreground))]">
            <Mail className="h-4 w-4" /> Email
          </div>
          <EField label="Subject">
            <EInput
              ref={subjectRef}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Email subject (supports {{variables}})"
            />
          </EField>
          {variables.length > 0 ? (
            <VariableChips
              variables={variables}
              onInsert={(v) => insertAtCaret(subjectRef, subject, setSubject, v)}
            />
          ) : null}

          {/* Rich HTML body designer */}
          <div className="pt-1">
            <p className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--e-gold-ink))]">
              HTML body
            </p>
            <EstateEmailDesigner
              design={design}
              onChange={setDesign}
              variables={variables}
            />
          </div>

          {/* Plain-text fallback */}
          <EField
            label="Plain-text fallback"
            hint="Shown by email clients that don't render HTML."
          >
            <ETextarea
              rows={4}
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              placeholder="Plain-text version (supports {{variables}})"
            />
          </EField>
          {variables.length > 0 ? (
            <VariableChips
              variables={variables}
              onInsert={(v) => appendToken(bodyText, setBodyText, v)}
            />
          ) : null}
        </section>

        {/* SMS */}
        <section className="space-y-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[0.8125rem] font-[600] text-[hsl(var(--e-foreground))]">
              <MessageSquare className="h-4 w-4" /> SMS
            </div>
            <EBadge tone="neutral" soft>
              {sms.length} chars · {smsSegments} segment
              {smsSegments > 1 ? "s" : ""}
            </EBadge>
          </div>
          <ETextarea
            rows={3}
            value={sms}
            onChange={(e) => setSms(e.target.value)}
            placeholder="SMS text (keep it short; {{variables}} supported)"
          />
          {variables.length > 0 ? (
            <VariableChips
              variables={variables}
              onInsert={(v) => appendToken(sms, setSms, v)}
            />
          ) : null}
          {sms ? (
            <div>
              <p className="mb-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--e-gold-ink))]">
                SMS preview
              </p>
              <div className="max-w-xs rounded-[var(--e-radius-lg)] rounded-bl-sm border border-[hsl(var(--e-border))] bg-[hsl(var(--e-primary)/0.08)] px-3 py-2 text-[0.8125rem] text-[hsl(var(--e-foreground))]">
                {smsPreview}
              </div>
            </div>
          ) : null}
        </section>

        {/* Actions */}
        <div className="flex items-center justify-between gap-2 border-t border-[hsl(var(--e-border))] pt-4">
          <EButton
            variant="ghost"
            size="sm"
            onClick={resetToDefault}
            disabled={saving || !template.inDb}
            title={
              template.inDb
                ? "Clear customisations and fall back to the default copy"
                : "Already using the default copy"
            }
          >
            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reset to default
          </EButton>
          <div className="flex gap-2">
            <EButton variant="outline" size="sm" onClick={onClose} disabled={saving}>
              Cancel
            </EButton>
            <EButton variant="gold" size="sm" onClick={save} disabled={saving}>
              {saving ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="mr-1 h-3.5 w-3.5" />
              )}
              Save template
            </EButton>
          </div>
        </div>
      </div>
    </EModal>
  );
}

const SAMPLE: Record<string, string> = {
  recipientName: "Alex Morgan",
  clientName: "Harborview Estates",
  cleanerName: "Jordan Lee",
  invoiceNumber: "INV-10428",
  totalAmount: "$1,240.00",
  amount: "$620.00",
  dueDate: "12 Aug 2026",
  paymentLink: "https://pay.sneek.com/inv-10428",
};

function fillSampleText(text: string, variables: string[]): string {
  let out = text;
  for (const v of variables) {
    out = out.split(`{{${v}}}`).join(SAMPLE[v] ?? `[${v}]`);
  }
  return out.replace(/\{\{\s*([\w.]+)\s*\}\}/g, "[$1]");
}
