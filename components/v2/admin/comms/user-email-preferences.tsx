"use client";

/**
 * Every automatic email one person can receive, with a switch on each.
 *
 * The bulk controls beside this can only apply ONE kind to many people at a
 * time, so the question "what is this person actually getting?" could only be
 * answered by a count badge. This shows the whole list for one person, which is
 * the form the question is actually asked in.
 *
 * Two levels, and they are not the same thing:
 *   - "Stop all email" (`allEmailOff`) is a standing instruction. It keeps
 *     meaning "send me nothing" as new kinds are added later, which a snapshot
 *     of per-kind switches could not.
 *   - The per-kind switches are exceptions to the default, which is ON.
 *
 * When "stop all email" is on, the per-kind switches are shown disabled rather
 * than hidden: the admin can still see what the person had chosen, and turning
 * the master back off restores exactly that instead of silently resetting it.
 *
 * Sign-in, password-reset and other recovery mail is sent as `critical` and
 * bypasses all of this — nobody can switch themselves out of being able to log
 * in. That is stated on screen because it is the first thing an admin worries
 * about before flipping the master.
 */

import * as React from "react";
import { Loader2 } from "lucide-react";
import { EAlert, EBadge, EButton } from "@/components/v2/ui/primitives";
import { EModal, ESwitch } from "@/components/v2/admin/estate-kit";
import { EMAIL_AUTO_KINDS } from "@/lib/notifications/email-kinds";

export function UserEmailPreferencesModal({
  userId,
  userLabel,
  open,
  onClose,
  onSaved,
}: {
  userId: string;
  userLabel: string;
  open: boolean;
  onClose: () => void;
  /** Lets the parent refresh its badges without re-fetching everything. */
  onSaved?: (next: { disabledKinds: string[]; allEmailOff: boolean }) => void;
}) {
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [allEmailOff, setAllEmailOff] = React.useState(false);
  const [disabled, setDisabled] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/admin/users/${userId}/email-preferences`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not load preferences.");
        if (cancelled) return;
        setAllEmailOff(Boolean(data.allEmailOff));
        setDisabled(Array.isArray(data.disabledKinds) ? data.disabledKinds : []);
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, userId]);

  function toggleKind(key: string, receiving: boolean) {
    // The list stores what is OFF, so receiving === true means remove it.
    setDisabled((prev) =>
      receiving ? prev.filter((k) => k !== key) : prev.includes(key) ? prev : [...prev, key]
    );
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}/email-preferences`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabledKinds: disabled, allEmailOff }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save preferences.");
      onSaved?.({ disabledKinds: disabled, allEmailOff });
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const offCount = disabled.length;

  return (
    <EModal open={open} onClose={onClose} eyebrow="Email preferences" title={userLabel} size="wide">
      {loading ? (
        <p className="flex items-center gap-2 py-6 text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading preferences…
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
            <div>
              <p className="text-[0.875rem] font-[600]">Stop all email</p>
              <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                Sends this person nothing automatic, including kinds added later. Sign-in and
                password-reset email still goes through.
              </p>
            </div>
            <ESwitch checked={allEmailOff} onCheckedChange={setAllEmailOff} />
          </div>

          <div className="flex items-center justify-between">
            <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
              {allEmailOff
                ? "All email is off. These are kept so turning it back on restores them."
                : "Everything is on by default. Switch off what they should not receive."}
            </p>
            {offCount > 0 ? (
              <EBadge tone="warning" soft>
                {offCount} off
              </EBadge>
            ) : null}
          </div>

          <div className="max-h-[26rem] space-y-1 overflow-y-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-1">
            {EMAIL_AUTO_KINDS.map((kind) => {
              const receiving = !disabled.includes(kind.key);
              return (
                <div
                  key={kind.key}
                  className="flex items-center justify-between gap-3 rounded-[var(--e-radius-sm)] p-2 hover:bg-[hsl(var(--e-muted)/0.4)]"
                >
                  <div className="min-w-0">
                    <p className="text-[0.8125rem] font-[600]">{kind.label}</p>
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      {kind.description}
                    </p>
                  </div>
                  <ESwitch
                    checked={receiving && !allEmailOff}
                    disabled={allEmailOff}
                    onCheckedChange={(next: boolean) => toggleKind(kind.key, next)}
                  />
                </div>
              );
            })}
          </div>

          {error ? <EAlert tone="danger">{error}</EAlert> : null}

          <div className="flex justify-end gap-2">
            <EButton variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </EButton>
            <EButton onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save preferences
            </EButton>
          </div>
        </div>
      )}
    </EModal>
  );
}
