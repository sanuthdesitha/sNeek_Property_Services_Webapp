"use client";

// "No photo taken" exemption roster — which cleaners may waive an upload
// requirement with a coded reason (unavoidable circumstances only). Lives in
// the Accountability tab beside the other cleaner-submission gates; saved via
// the same partial PATCH /api/admin/settings as every other section.

import { useEffect, useState } from "react";
import { CameraOff } from "lucide-react";
import { EButton, ECard } from "@/components/v2/ui/primitives";
import { ESaveStatus, ESectionHeading, EToggle, useSaveStatus } from "./estate-form";

type CleanerRow = { id: string; name: string | null; email: string };

export function NoPhotoSection({ initial, readOnly }: { initial: string[]; readOnly: boolean }) {
  const [cleaners, setCleaners] = useState<CleanerRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initial));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { status, flash } = useSaveStatus();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/users?role=CLEANER", { cache: "no-store" })
      .then((res) => res.json())
      .then((rows) => {
        if (cancelled) return;
        setCleaners(
          (Array.isArray(rows) ? rows : rows?.users ?? []).map((u: any) => ({
            id: String(u.id),
            name: u.name ?? null,
            email: String(u.email ?? ""),
          }))
        );
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function save() {
    if (readOnly) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noPhotoExemptCleanerIds: Array.from(selected) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        flash("error", body.error ?? "Could not save the exemption list.");
        return;
      }
      flash("saved", "Exemption list saved");
    } catch {
      flash("error", "Could not save the exemption list.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ECard className="p-5">
      <ESectionHeading
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <CameraOff className="h-3.5 w-3.5" /> Cleaner permissions
          </span>
        }
        title='"No photo taken" exemption'
        description="Exempted cleaners get an 'I couldn't take a photo' option on photo fields. It requires a coded reason, is meant for unavoidable circumstances only, appears on the report, and automatically deducts QA points per missed field. Photos remain the expectation."
      />
      {loading ? (
        <p className="mt-3 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading cleaners…</p>
      ) : cleaners.length === 0 ? (
        <p className="mt-3 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">No active cleaners found.</p>
      ) : (
        <div className="mt-3 divide-y divide-[hsl(var(--e-border))]">
          {cleaners.map((cleaner) => (
            <div key={cleaner.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-[0.875rem] font-[550]">{cleaner.name ?? cleaner.email}</p>
                {cleaner.name ? (
                  <p className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{cleaner.email}</p>
                ) : null}
              </div>
              <EToggle
                checked={selected.has(cleaner.id)}
                disabled={readOnly || saving}
                onChange={(on: boolean) => toggle(cleaner.id, on)}
              />
            </div>
          ))}
        </div>
      )}
      <div className="mt-4 flex items-center justify-end gap-3">
        <ESaveStatus status={status} />
        <EButton size="sm" onClick={() => void save()} disabled={readOnly || saving || loading}>
          {saving ? "Saving…" : "Save exemptions"}
        </EButton>
      </div>
    </ECard>
  );
}
