"use client";

import { useState } from "react";
import { StickyNote } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

/**
 * Admin-editable notes for a staff account. Persists to User.notes via
 * PUT /api/admin/users/[id]/notes.
 */
export function EditableStaffNotes({
  userId,
  initialNotes,
  ownNotes = null,
}: {
  userId: string;
  /** The office's private note (User.adminNotes). */
  initialNotes: string | null;
  /** What this person wrote in their own profile (User.notes). Read-only here. */
  ownNotes?: string | null;
}) {
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
    <Card className="rounded-2xl">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <StickyNote className="h-4 w-4 text-primary" />
          Admin notes
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Internal notes about this staff member (visible to admins only)..."
          rows={5}
          className="resize-y"
        />
        {ownNotes?.trim() ? (
          <div className="rounded-lg border bg-muted/40 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Written by the account holder
            </p>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">{ownNotes}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              From their own profile. They can see and change this text.
            </p>
          </div>
        ) : null}
        <div className="flex items-center justify-end gap-2">
          {dirty ? (
            <Button variant="ghost" size="sm" onClick={() => setValue(saved)} disabled={saving}>
              Cancel
            </Button>
          ) : null}
          <Button size="sm" onClick={save} disabled={saving || !dirty}>
            {saving ? "Saving..." : "Save notes"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
