"use client";

/**
 * ESTATE staff notes editor — v2-native replacement for
 * components/accounts/editable-staff-notes.tsx. Same PUT /api/admin/users/:id/notes.
 */
import { useState } from "react";
import { toast } from "@/hooks/use-toast";
import { EButton, ECard, ECardBody, ECardHeader, ECardTitle } from "@/components/v2/ui/primitives";
import { ETextarea } from "@/components/v2/admin/estate-kit";

export function AccountNotes({ userId, initialNotes }: { userId: string; initialNotes: string | null }) {
  const [value, setValue] = useState(initialNotes ?? "");
  const [saved, setSaved] = useState(initialNotes ?? "");
  const [saving, setSaving] = useState(false);
  const dirty = value !== saved;

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}/notes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: value }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save notes.");
      setSaved(value);
      toast({ title: "Notes saved" });
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <ECard>
      <ECardHeader className="pb-2">
        <ECardTitle className="text-[0.95rem]">Internal notes</ECardTitle>
      </ECardHeader>
      <ECardBody className="space-y-3 pt-0">
        <ETextarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Private notes about this account (visible to admins only)…"
          className="min-h-[6rem]"
        />
        <div className="flex justify-end">
          <EButton variant="gold" size="sm" onClick={save} disabled={saving || !dirty}>
            {saving ? "Saving…" : "Save notes"}
          </EButton>
        </div>
      </ECardBody>
    </ECard>
  );
}
