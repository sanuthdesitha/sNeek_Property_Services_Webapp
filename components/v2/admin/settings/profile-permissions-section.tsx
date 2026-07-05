"use client";

import { useState } from "react";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { EToggle, ESaveStatus, ESectionHeading, useSaveStatus } from "./estate-form";

/**
 * Profile-edit permissions by role. Mirrors settings-editor.tsx: per-role
 * canEditName / canEditPhone / canEditEmail toggles. Only the five roles the
 * PATCH /api/admin/settings profileEditPolicy schema accepts are rendered
 * (ADMIN, OPS_MANAGER, CLEANER, CLIENT, LAUNDRY), matching v1's ROLES list.
 */
type Policy = { canEditName: boolean; canEditPhone: boolean; canEditEmail: boolean };
export type ProfilePermissionsSettings = Record<string, Policy>;

const ROLES = ["ADMIN", "OPS_MANAGER", "CLEANER", "CLIENT", "LAUNDRY"] as const;
const PERMS: Array<[keyof Policy, string]> = [
  ["canEditName", "Name"],
  ["canEditPhone", "Phone"],
  ["canEditEmail", "Email"],
];

export function ProfilePermissionsSection({
  initial,
  readOnly,
}: {
  initial: ProfilePermissionsSettings;
  readOnly: boolean;
}) {
  const [form, setForm] = useState<ProfilePermissionsSettings>(initial);
  const [saving, setSaving] = useState(false);
  const { status, flash } = useSaveStatus();

  function setPerm(role: string, perm: keyof Policy, value: boolean) {
    setForm((p) => ({ ...p, [role]: { ...p[role], [perm]: value } }));
  }

  async function save() {
    if (readOnly) return;
    setSaving(true);
    try {
      // Send only the roles the PATCH schema accepts, mirroring v1's ROLES list.
      const payload: ProfilePermissionsSettings = {};
      for (const role of ROLES) {
        if (form[role]) payload[role] = form[role];
      }
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileEditPolicy: payload }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        flash("error", body.error ?? "Could not save settings.");
        return;
      }
      flash("saved", "Settings saved");
    } catch {
      flash("error", "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <ESectionHeading
        eyebrow="Access"
        title="Profile edit permissions"
        description="Which profile fields each role may edit on their own account."
      />

      <ECard className="p-6">
        <div className="space-y-3">
          {ROLES.map((role) => {
            const policy = form[role] ?? { canEditName: false, canEditPhone: false, canEditEmail: false };
            return (
              <div
                key={role}
                className="grid items-center gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-4 sm:grid-cols-4"
              >
                <p className="text-[0.875rem] font-medium">{role}</p>
                {PERMS.map(([perm, label]) => (
                  <div
                    key={perm}
                    className="flex items-center justify-between gap-2 rounded-[var(--e-radius-sm)] border border-[hsl(var(--e-border))] px-3 py-2"
                  >
                    <span className="text-[0.75rem] text-[hsl(var(--e-text-secondary))]">{label}</span>
                    <EToggle
                      checked={policy[perm]}
                      onChange={(v) => setPerm(role, perm, v)}
                      disabled={readOnly}
                    />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </ECard>

      <div className="flex items-center justify-end gap-3">
        <ESaveStatus status={status} />
        {!readOnly ? (
          <EButton onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </EButton>
        ) : (
          <p className="text-[0.8125rem] text-[hsl(var(--e-text-faint))]">Read-only — administrator access required to edit.</p>
        )}
      </div>
    </div>
  );
}
