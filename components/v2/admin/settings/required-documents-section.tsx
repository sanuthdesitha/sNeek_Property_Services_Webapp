"use client";

/**
 * Settings → Access → Required documents (Wave E, 2026-11): which staff
 * document types each role must have on file. Empty by default: with nothing
 * required, no person is shown as missing anything. Drives the person panel's
 * Documents list and the Accounts list's "missing" counts. ADMIN saves.
 */
import * as React from "react";
import { ECard, ECardBody, ECardHeader, ECardTitle, EButton } from "@/components/v2/ui/primitives";
import { ROLE_LABELS } from "@/lib/auth/roles";
import {
  REQUIREMENT_ROLES,
  STAFF_DOCUMENT_CATEGORIES,
  STAFF_DOCUMENT_CATEGORY_LABEL,
  type RequiredDocumentsSetting,
  type RequirementRole,
  type StaffDocumentCategory,
} from "@/lib/accounts/required-documents";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; saved: RequiredDocumentsSetting; readable: boolean };
type ByRole = Partial<Record<RequirementRole, StaffDocumentCategory[]>>;

function sameSetting(left: ByRole, right: ByRole): boolean {
  return REQUIREMENT_ROLES.every((role) => [...(left[role] ?? [])].sort().join(",") === [...(right[role] ?? [])].sort().join(","));
}

export function RequiredDocumentsSettingsSection({ canSave }: { canSave: boolean }) {
  const [load, setLoad] = React.useState<Load>({ status: "loading" });
  const [draft, setDraft] = React.useState<ByRole>({});
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<{ tone: "ok" | "error"; text: string } | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/users/required-documents", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as (RequiredDocumentsSetting & { readable?: boolean; error?: string }) | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !body?.byRole) throw new Error(body?.error ?? "Could not load the setting.");
        setLoad({ status: "ready", saved: { byRole: body.byRole }, readable: body.readable !== false });
        setDraft(body.byRole);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoad({ status: "error", message: error instanceof Error ? error.message : "Could not load the setting." });
      });
    return () => controller.abort();
  }, []);

  function toggle(role: RequirementRole, category: StaffDocumentCategory) {
    setDraft((current) => {
      const list = current[role] ?? [];
      const next = list.includes(category) ? list.filter((item) => item !== category) : [...list, category];
      return { ...current, [role]: next };
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/users/required-documents", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ byRole: draft }) });
      const body = (await response.json().catch(() => null)) as (RequiredDocumentsSetting & { error?: string }) | null;
      if (!response.ok || !body?.byRole) throw new Error(body?.error ?? "The setting was not saved.");
      setLoad({ status: "ready", saved: { byRole: body.byRole }, readable: true });
      setDraft(body.byRole);
      setMessage({ tone: "ok", text: "Required documents saved." });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "The setting was not saved. Your choices are still here." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <ECard>
      <ECardHeader className="p-5 pb-0">
        <ECardTitle className="text-[1rem]">Required documents</ECardTitle>
      </ECardHeader>
      <ECardBody className="space-y-3 p-5">
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          The document types each role must have on file. A person&apos;s Documents section shows each one as on file, expiring, expired or missing, and the Accounts list counts the missing ones. Nothing is required until you tick it here.
        </p>
        {load.status === "loading" ? <p role="status" className="text-[0.8125rem]">Loading…</p> : null}
        {load.status === "error" ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{load.message}</p> : null}
        {load.status === "ready" && !load.readable ? (
          <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">The saved list could not be read, so nothing is being checked. Choose the requirements again and save.</p>
        ) : null}
        {load.status === "ready" ? (
          <form onSubmit={submit}>
            <fieldset disabled={saving || !canSave} className="space-y-3">
              {REQUIREMENT_ROLES.map((role) => (
                <fieldset key={role} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3 py-2">
                  <legend className="px-1 text-[0.8125rem] font-[600]">{ROLE_LABELS[role]}</legend>
                  <div className="flex flex-wrap gap-x-4 gap-y-2">
                    {STAFF_DOCUMENT_CATEGORIES.map((category) => (
                      <label key={category} className="inline-flex min-h-9 items-center gap-2 text-[0.8125rem]">
                        <input type="checkbox" checked={(draft[role] ?? []).includes(category)} onChange={() => toggle(role, category)} />
                        {STAFF_DOCUMENT_CATEGORY_LABEL[category]}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
              {canSave ? (
                <EButton type="submit" size="sm" disabled={sameSetting(draft, load.saved.byRole)}>{saving ? "Saving…" : "Save"}</EButton>
              ) : (
                <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Only an administrator can change this.</p>
              )}
            </fieldset>
          </form>
        ) : null}
        {message ? <p role={message.tone === "error" ? "alert" : "status"} className={message.tone === "error" ? "text-[0.8125rem] text-[hsl(var(--e-danger))]" : "text-[0.8125rem] text-[hsl(var(--e-success))]"}>{message.text}</p> : null}
      </ECardBody>
    </ECard>
  );
}
