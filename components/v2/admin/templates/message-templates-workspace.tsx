"use client";

/**
 * Estate message-template designer — manages the standalone marketing / lifecycle
 * message templates (MessageTemplate model) via /api/admin/message-templates and
 * /api/admin/message-templates/[id]. Separate set from the notification templates.
 *
 * Body shape matches the v1 endpoints exactly:
 *   POST  { name, triggerType, jobType, channel, subject, body, isActive }
 *   PATCH { ...same, all optional }
 *   DELETE by id
 */

import * as React from "react";
import { Loader2, Plus, Search, Save, Trash2, MessageSquare } from "lucide-react";
import { EBadge, EButton, EEmptyState } from "@/components/v2/ui/primitives";
import {
  EConfirmModal,
  EField,
  EInput,
  EModal,
  ESelect,
  ESwitch,
  ETableShell,
  ETextarea,
} from "@/components/v2/admin/estate-kit";
import { VariableChips } from "@/components/v2/admin/templates/estate-email-designer";

type MessageTemplate = {
  id: string;
  name: string;
  triggerType: "POST_JOB" | "REVIEW_REQUEST" | "DISCOUNT" | "NEXT_CLEAN" | "MANUAL";
  jobType: string | null;
  channel: "EMAIL" | "SMS";
  subject: string | null;
  body: string;
  isActive: boolean;
};

const TRIGGERS: MessageTemplate["triggerType"][] = [
  "POST_JOB",
  "REVIEW_REQUEST",
  "DISCOUNT",
  "NEXT_CLEAN",
  "MANUAL",
];

const TRIGGER_LABEL: Record<MessageTemplate["triggerType"], string> = {
  POST_JOB: "Post-job",
  REVIEW_REQUEST: "Review request",
  DISCOUNT: "Discount",
  NEXT_CLEAN: "Next clean",
  MANUAL: "Manual",
};

// Merge variables the message-template engine supports (per the MessageTemplate model).
const MESSAGE_VARS = [
  "client_name",
  "property_address",
  "cleaner_name",
  "next_clean_date",
  "job_type",
  "feedback_url",
];

const EMPTY: Omit<MessageTemplate, "id"> = {
  name: "",
  triggerType: "MANUAL",
  jobType: null,
  channel: "EMAIL",
  subject: "",
  body: "",
  isActive: true,
};

export function MessageTemplatesWorkspace() {
  const [templates, setTemplates] = React.useState<MessageTemplate[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [query, setQuery] = React.useState("");
  const [editing, setEditing] = React.useState<MessageTemplate | "new" | null>(
    null
  );

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/message-templates");
      if (res.ok) setTemplates((await res.json()) as MessageTemplate[]);
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
        t.name.toLowerCase().includes(q) ||
        TRIGGER_LABEL[t.triggerType].toLowerCase().includes(q) ||
        t.channel.toLowerCase().includes(q)
    );
  }, [templates, query]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] px-4 py-10 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading message templates…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--e-text-faint))]" />
          <EInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search message templates…"
            className="pl-9"
          />
        </div>
        <EButton variant="gold" size="sm" onClick={() => setEditing("new")}>
          <Plus className="mr-1 h-3.5 w-3.5" /> New template
        </EButton>
      </div>

      {templates.length === 0 ? (
        <div className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] p-6">
          <EEmptyState
            eyebrow="Message templates"
            title="No message templates yet"
            description="Create reusable post-job, review-request and marketing messages."
            action={
              <EButton variant="gold" size="sm" onClick={() => setEditing("new")}>
                <Plus className="mr-1 h-3.5 w-3.5" /> New template
              </EButton>
            }
          />
        </div>
      ) : (
        <div className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))]">
          <ETableShell
            headers={[
              { label: "Name" },
              { label: "Trigger" },
              { label: "Channel" },
              { label: "Status" },
              { label: "", align: "right" },
            ]}
          >
            {filtered.map((t) => (
              <tr
                key={t.id}
                className="cursor-pointer transition-colors hover:bg-[hsl(var(--e-muted)/0.4)]"
                onClick={() => setEditing(t)}
              >
                <td className="px-4 py-3 font-[550] text-[hsl(var(--e-foreground))]">
                  {t.name}
                </td>
                <td className="px-4 py-3 text-[hsl(var(--e-text-secondary))]">
                  {TRIGGER_LABEL[t.triggerType]}
                </td>
                <td className="px-4 py-3 text-[hsl(var(--e-text-secondary))]">
                  {t.channel}
                </td>
                <td className="px-4 py-3">
                  {t.isActive ? (
                    <EBadge tone="success" soft>
                      Active
                    </EBadge>
                  ) : (
                    <EBadge tone="neutral" soft>
                      Inactive
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
                eyebrow="Message templates"
                title="No matching templates"
                description="Try a different search term."
              />
            </div>
          ) : null}
        </div>
      )}

      {editing ? (
        <MessageEditor
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

function MessageEditor({
  initial,
  onClose,
  onDone,
}: {
  initial: MessageTemplate | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = React.useState<Omit<MessageTemplate, "id">>(
    initial
      ? {
          name: initial.name,
          triggerType: initial.triggerType,
          jobType: initial.jobType,
          channel: initial.channel,
          subject: initial.subject ?? "",
          body: initial.body,
          isActive: initial.isActive,
        }
      : { ...EMPTY }
  );
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const subjectRef = React.useRef<HTMLInputElement>(null);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  /** Caret insert for the (ref-forwarding) subject EInput. */
  function insertSubjectToken(token: string) {
    const value = form.subject ?? "";
    const el = subjectRef.current;
    const insert = `{{${token}}}`;
    if (!el) {
      set("subject", `${value}${insert}`);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    set("subject", value.slice(0, start) + insert + value.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + insert.length;
      el.setSelectionRange(pos, pos);
    });
  }

  /** ETextarea isn't ref-forwarding → append to the body. */
  function appendBodyToken(token: string) {
    set("body", `${form.body}{{${token}}}`);
  }

  async function save() {
    if (!form.name.trim() || !form.body.trim()) {
      setError("Name and body are required.");
      return;
    }
    setSaving(true);
    setError(null);
    const payload = {
      name: form.name,
      triggerType: form.triggerType,
      jobType: form.jobType || null,
      channel: form.channel,
      subject: form.channel === "EMAIL" ? form.subject || null : null,
      body: form.body,
      isActive: form.isActive,
    };
    try {
      const res = await fetch(
        initial
          ? `/api/admin/message-templates/${initial.id}`
          : "/api/admin/message-templates",
        {
          method: initial ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setError(e.error ?? "Save failed.");
        return;
      }
      onDone();
    } catch {
      setError("Network error while saving.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!initial) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/message-templates/${initial.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setError(e.error ?? "Delete failed.");
        setConfirmDelete(false);
        return;
      }
      onDone();
    } catch {
      setError("Network error while deleting.");
    } finally {
      setDeleting(false);
    }
  }

  const bodySegments = Math.max(1, Math.ceil((form.body.length || 1) / 160));

  return (
    <>
      <EModal
        open
        onClose={onClose}
        size="xl"
        eyebrow={initial ? "Edit message template" : "New message template"}
        title={form.name || "Untitled template"}
      >
        <div className="space-y-5">
          {error ? (
            <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-danger)/0.4)] bg-[hsl(var(--e-danger)/0.08)] px-3 py-2 text-[0.8125rem] text-[hsl(var(--e-danger))]">
              {error}
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <EField label="Name" className="sm:col-span-2">
              <EInput
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="e.g. Post-job thank-you"
              />
            </EField>

            <EField label="Trigger">
              <ESelect
                value={form.triggerType}
                onChange={(e) =>
                  set("triggerType", e.target.value as MessageTemplate["triggerType"])
                }
              >
                {TRIGGERS.map((t) => (
                  <option key={t} value={t}>
                    {TRIGGER_LABEL[t]}
                  </option>
                ))}
              </ESelect>
            </EField>

            <EField label="Channel">
              <ESelect
                value={form.channel}
                onChange={(e) =>
                  set("channel", e.target.value as MessageTemplate["channel"])
                }
              >
                <option value="EMAIL">Email</option>
                <option value="SMS">SMS</option>
              </ESelect>
            </EField>

            <EField
              label="Job type"
              hint="Leave blank to apply to all job types."
              className="sm:col-span-2"
            >
              <EInput
                value={form.jobType ?? ""}
                onChange={(e) => set("jobType", e.target.value || null)}
                placeholder="All job types"
              />
            </EField>
          </div>

          {form.channel === "EMAIL" ? (
            <div className="space-y-2">
              <EField label="Subject">
                <EInput
                  ref={subjectRef}
                  value={form.subject ?? ""}
                  onChange={(e) => set("subject", e.target.value)}
                  placeholder="Email subject (supports {{variables}})"
                />
              </EField>
              <VariableChips
                variables={MESSAGE_VARS}
                onInsert={insertSubjectToken}
              />
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[0.75rem] font-[550] tracking-[0.04em] text-[hsl(var(--e-text-secondary))]">
                Body
              </span>
              {form.channel === "SMS" ? (
                <EBadge tone="neutral" soft>
                  {form.body.length} chars · {bodySegments} segment
                  {bodySegments > 1 ? "s" : ""}
                </EBadge>
              ) : null}
            </div>
            <ETextarea
              rows={form.channel === "SMS" ? 4 : 8}
              value={form.body}
              onChange={(e) => set("body", e.target.value)}
              placeholder="Message body (supports {{variables}})"
            />
            <VariableChips variables={MESSAGE_VARS} onInsert={appendBodyToken} />
          </div>

          {/* Preview */}
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-[hsl(var(--e-gold-ink))]">
              <MessageSquare className="h-3.5 w-3.5" /> Preview
            </p>
            <div className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-sunken))] p-3 text-[0.8125rem] text-[hsl(var(--e-foreground))]">
              {form.channel === "EMAIL" && form.subject ? (
                <p className="mb-1 font-[600]">
                  {fillMessageSample(form.subject)}
                </p>
              ) : null}
              <p className="whitespace-pre-wrap">
                {fillMessageSample(form.body) || (
                  <span className="text-[hsl(var(--e-text-faint))]">
                    Nothing to preview yet.
                  </span>
                )}
              </p>
            </div>
          </div>

          <ESwitch
            checked={form.isActive}
            onCheckedChange={(v) => set("isActive", v)}
            label="Active"
          />

          <div className="flex items-center justify-between gap-2 border-t border-[hsl(var(--e-border))] pt-4">
            {initial ? (
              <EButton
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDelete(true)}
                disabled={saving || deleting}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
              </EButton>
            ) : (
              <span />
            )}
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
                {initial ? "Save changes" : "Create template"}
              </EButton>
            </div>
          </div>
        </div>
      </EModal>

      <EConfirmModal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete message template?"
        description="This removes the template and unlinks it from any automation rules. This cannot be undone."
        confirmLabel="Delete template"
        danger
        loading={deleting}
        onConfirm={remove}
      />
    </>
  );
}

const MESSAGE_SAMPLE: Record<string, string> = {
  client_name: "Harborview Estates",
  property_address: "42 Marina Parade",
  cleaner_name: "Jordan Lee",
  next_clean_date: "14 Jul 2026",
  job_type: "End of lease",
  feedback_url: "https://app.sneek.com/review/abc",
};

function fillMessageSample(text: string): string {
  let out = text;
  for (const v of MESSAGE_VARS) {
    out = out.split(`{{${v}}}`).join(MESSAGE_SAMPLE[v] ?? `[${v}]`);
  }
  return out.replace(/\{\{\s*([\w.]+)\s*\}\}/g, "[$1]");
}
