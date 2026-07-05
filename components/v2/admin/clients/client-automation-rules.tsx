"use client";

/**
 * Estate client automation rules — native v2 admin surface for the per-client
 * message automation rules that previously had no v2 UI (v1 had a partially
 * wired panel in components/admin/client-detail-workspace.tsx).
 *
 * Wired to the SAME endpoints as v1:
 *   GET    /api/admin/clients/[id]/automation-rules
 *   POST   /api/admin/clients/[id]/automation-rules
 *   PATCH  /api/admin/clients/[id]/automation-rules/[ruleId]
 *   DELETE /api/admin/clients/[id]/automation-rules/[ruleId]
 * Templates come from GET /api/admin/message-templates (MessageTemplate model).
 *
 * Rule shape (ClientAutomationRule): triggerType, jobType, templateId,
 * delayMinutes, channel, isEnabled.
 *
 * Estate token scope only (--e-*), primitives + estate-kit + lucide. No imports
 * from components/{admin,ui,shared} or app/admin.
 */
import { useCallback, useEffect, useState } from "react";
import { Clock, Mail, MessageSquare, Pencil, Plus, Trash2, Zap } from "lucide-react";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
} from "@/components/v2/ui/primitives";
import {
  EConfirmModal,
  EField,
  EInput,
  EModal,
  ESelect,
  ESwitch,
} from "@/components/v2/admin/estate-kit";
import { useEstateToast, EToastViewport } from "@/components/v2/admin/comms/toast";

type Channel = "EMAIL" | "SMS" | "BOTH";
type TriggerType =
  | "POST_JOB_REVIEW"
  | "POST_JOB_NEXT_CLEAN"
  | "POST_JOB_DISCOUNT"
  | "POST_JOB_CUSTOM";

type TemplateRef = {
  id: string;
  name: string;
  triggerType?: string;
  channel?: string;
} | null;

type Rule = {
  id: string;
  triggerType: TriggerType;
  jobType: string | null;
  templateId: string | null;
  delayMinutes: number;
  isEnabled: boolean;
  channel: Channel;
  template?: TemplateRef;
};

type Template = {
  id: string;
  name: string;
  channel: string;
  triggerType: string;
  isActive: boolean;
};

const TRIGGER_META: Record<TriggerType, { label: string; description: string; tone: "primary" | "gold" | "aubergine" | "info" }> = {
  POST_JOB_REVIEW: { label: "Review request", description: "Ask for a review after a completed clean.", tone: "gold" },
  POST_JOB_NEXT_CLEAN: { label: "Next clean nudge", description: "Prompt the client to book the next clean.", tone: "primary" },
  POST_JOB_DISCOUNT: { label: "Discount offer", description: "Send a loyalty or re-book discount.", tone: "aubergine" },
  POST_JOB_CUSTOM: { label: "Custom follow-up", description: "Any bespoke post-job message.", tone: "info" },
};

const TRIGGER_ORDER: TriggerType[] = [
  "POST_JOB_REVIEW",
  "POST_JOB_NEXT_CLEAN",
  "POST_JOB_DISCOUNT",
  "POST_JOB_CUSTOM",
];

const CHANNEL_META: Record<Channel, { label: string }> = {
  EMAIL: { label: "Email" },
  SMS: { label: "SMS" },
  BOTH: { label: "Email + SMS" },
};

/** Present delayMinutes as a human phrase. */
function formatDelay(minutes: number): string {
  if (minutes <= 0) return "Immediately";
  if (minutes < 60) return `${minutes} min after job`;
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `${days} day${days === 1 ? "" : "s"} after job`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? "" : "s"} after job`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m after job`;
}

type FormState = {
  triggerType: TriggerType;
  jobType: string;
  templateId: string;
  delayMinutes: string;
  channel: Channel;
  isEnabled: boolean;
};

const EMPTY_FORM: FormState = {
  triggerType: "POST_JOB_REVIEW",
  jobType: "",
  templateId: "",
  delayMinutes: "120",
  channel: "EMAIL",
  isEnabled: false,
};

export function ClientAutomationRules({ clientId }: { clientId: string }) {
  const { toast, push } = useEstateToast();
  const [rules, setRules] = useState<Rule[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Rule | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rulesRes, tplRes] = await Promise.all([
        fetch(`/api/admin/clients/${clientId}/automation-rules`, { cache: "no-store" }),
        fetch("/api/admin/message-templates", { cache: "no-store" }),
      ]);
      const rulesBody = await rulesRes.json().catch(() => []);
      const tplBody = await tplRes.json().catch(() => []);
      if (rulesRes.ok && Array.isArray(rulesBody)) setRules(rulesBody);
      if (tplRes.ok && Array.isArray(tplBody)) setTemplates(tplBody);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setEditorOpen(true);
  }

  function openEdit(rule: Rule) {
    setEditing(rule);
    setForm({
      triggerType: rule.triggerType,
      jobType: rule.jobType ?? "",
      templateId: rule.templateId ?? "",
      delayMinutes: String(rule.delayMinutes ?? 120),
      channel: rule.channel,
      isEnabled: rule.isEnabled,
    });
    setEditorOpen(true);
  }

  async function saveRule() {
    setSaving(true);
    try {
      const payload = {
        triggerType: form.triggerType,
        jobType: form.jobType.trim() ? form.jobType.trim() : null,
        templateId: form.templateId ? form.templateId : null,
        delayMinutes: Math.max(0, Number.parseInt(form.delayMinutes, 10) || 0),
        channel: form.channel,
        isEnabled: form.isEnabled,
      };
      const url = editing
        ? `/api/admin/clients/${clientId}/automation-rules/${editing.id}`
        : `/api/admin/clients/${clientId}/automation-rules`;
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        push({ title: "Save failed", description: body.error ?? "Could not save the rule.", tone: "danger" });
        return;
      }
      push({ title: editing ? "Rule updated" : "Rule created", tone: "success" });
      setEditorOpen(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function toggleRule(rule: Rule, next: boolean) {
    setTogglingId(rule.id);
    // Optimistic
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, isEnabled: next } : r)));
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/automation-rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isEnabled: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        push({ title: "Could not update", description: body.error ?? "Toggle failed.", tone: "danger" });
        setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, isEnabled: !next } : r)));
        return;
      }
      push({ title: next ? "Rule enabled" : "Rule paused", tone: "success" });
    } finally {
      setTogglingId(null);
    }
  }

  async function deleteRule() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/clients/${clientId}/automation-rules/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        push({ title: "Delete failed", description: body.error ?? "Could not delete the rule.", tone: "danger" });
        return;
      }
      push({ title: "Rule deleted", tone: "success" });
      setRules((prev) => prev.filter((r) => r.id !== deleteTarget.id));
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  const enabledCount = rules.filter((r) => r.isEnabled).length;

  return (
    <ECard>
      <ECardHeader className="flex-row items-center justify-between pb-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[hsl(var(--e-gold-soft))] text-[hsl(var(--e-gold))]">
            <Zap className="h-4 w-4" />
          </span>
          <div>
            <ECardTitle className="text-[0.95rem]">Message automation</ECardTitle>
            <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
              {loading ? "Loading rules…" : `${rules.length} rule${rules.length === 1 ? "" : "s"} · ${enabledCount} active`}
            </p>
          </div>
        </div>
        <EButton size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4" />New rule
        </EButton>
      </ECardHeader>
      <ECardBody className="pt-0">
        {loading ? (
          <p className="py-6 text-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading automation rules…</p>
        ) : rules.length === 0 ? (
          <EEmptyState
            eyebrow="No automation"
            title="No post-job messages yet"
            description="Add a rule to automatically follow up with this client after a job — a review request, a re-book nudge, a discount offer."
            action={<EButton size="sm" onClick={openCreate}><Plus className="h-4 w-4" />Create first rule</EButton>}
          />
        ) : (
          <ul className="space-y-2.5">
            {rules.map((rule) => {
              const meta = TRIGGER_META[rule.triggerType];
              const templateName = rule.template?.name ?? templates.find((t) => t.id === rule.templateId)?.name ?? null;
              return (
                <li
                  key={rule.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3.5 py-3"
                >
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <EBadge tone={meta.tone} soft>{meta.label}</EBadge>
                      <span className="inline-flex items-center gap-1 text-[0.6875rem] text-[hsl(var(--e-text-secondary))]">
                        {rule.channel === "SMS" ? <MessageSquare className="h-3 w-3" /> : rule.channel === "BOTH" ? <><Mail className="h-3 w-3" /><MessageSquare className="h-3 w-3" /></> : <Mail className="h-3 w-3" />}
                        {CHANNEL_META[rule.channel].label}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                        <Clock className="h-3 w-3" />{formatDelay(rule.delayMinutes)}
                      </span>
                      {rule.jobType ? (
                        <span className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">· {rule.jobType.replaceAll("_", " ").toLowerCase()} only</span>
                      ) : null}
                    </div>
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      {templateName ? (
                        <>Uses template <span className="font-[550] text-[hsl(var(--e-text-secondary))]">{templateName}</span></>
                      ) : (
                        <span className="text-[hsl(var(--e-warning))]">No template selected — a default message will be used.</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <ESwitch
                      checked={rule.isEnabled}
                      disabled={togglingId === rule.id}
                      onCheckedChange={(v) => toggleRule(rule, v)}
                      label={rule.isEnabled ? "Active" : "Paused"}
                    />
                    <EButton size="icon" variant="ghost" onClick={() => openEdit(rule)} aria-label="Edit rule">
                      <Pencil className="h-4 w-4" />
                    </EButton>
                    <EButton size="icon" variant="ghost" onClick={() => setDeleteTarget(rule)} aria-label="Delete rule">
                      <Trash2 className="h-4 w-4 text-[hsl(var(--e-danger))]" />
                    </EButton>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </ECardBody>

      {/* Create / edit editor */}
      <EModal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        eyebrow={editing ? "Edit rule" : "New rule"}
        title={editing ? "Edit automation rule" : "New automation rule"}
      >
        <div className="space-y-4">
          <EField label="Trigger" hint={TRIGGER_META[form.triggerType].description}>
            <ESelect
              value={form.triggerType}
              onChange={(e) => setForm((p) => ({ ...p, triggerType: e.target.value as TriggerType }))}
            >
              {TRIGGER_ORDER.map((t) => (
                <option key={t} value={t}>{TRIGGER_META[t].label}</option>
              ))}
            </ESelect>
          </EField>

          <EField label="Message template" hint="Pick a message template, or leave blank to use the built-in default.">
            <ESelect
              value={form.templateId}
              onChange={(e) => setForm((p) => ({ ...p, templateId: e.target.value }))}
            >
              <option value="">No template (default message)</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.isActive ? "" : " (inactive)"}
                </option>
              ))}
            </ESelect>
          </EField>

          <div className="grid gap-4 sm:grid-cols-2">
            <EField label="Channel">
              <ESelect
                value={form.channel}
                onChange={(e) => setForm((p) => ({ ...p, channel: e.target.value as Channel }))}
              >
                <option value="EMAIL">Email</option>
                <option value="SMS">SMS</option>
                <option value="BOTH">Email + SMS</option>
              </ESelect>
            </EField>
            <EField label="Delay (minutes after job)" hint={formatDelay(Math.max(0, Number.parseInt(form.delayMinutes, 10) || 0))}>
              <EInput
                type="number"
                min={0}
                value={form.delayMinutes}
                onChange={(e) => setForm((p) => ({ ...p, delayMinutes: e.target.value }))}
              />
            </EField>
          </div>

          <EField label="Limit to job type" hint="Optional. Leave blank to apply to every job type.">
            <EInput
              value={form.jobType}
              placeholder="e.g. STANDARD_CLEAN (blank = all)"
              onChange={(e) => setForm((p) => ({ ...p, jobType: e.target.value }))}
            />
          </EField>

          <div className="flex items-center justify-between rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3">
            <div>
              <p className="text-[0.8125rem] font-[550] text-[hsl(var(--e-foreground))]">Active</p>
              <p className="text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">Rules start paused so you can review before they send.</p>
            </div>
            <ESwitch checked={form.isEnabled} onCheckedChange={(v) => setForm((p) => ({ ...p, isEnabled: v }))} />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <EButton variant="outline" size="sm" onClick={() => setEditorOpen(false)} disabled={saving}>Cancel</EButton>
            <EButton size="sm" onClick={saveRule} disabled={saving}>
              {saving ? "Saving…" : editing ? "Save changes" : "Create rule"}
            </EButton>
          </div>
        </div>
      </EModal>

      <EConfirmModal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Delete automation rule"
        description={deleteTarget ? `Remove the "${TRIGGER_META[deleteTarget.triggerType].label}" rule for this client? This cannot be undone.` : ""}
        confirmLabel="Delete rule"
        loading={deleting}
        onConfirm={deleteRule}
      />

      <EToastViewport toast={toast} />
    </ECard>
  );
}
