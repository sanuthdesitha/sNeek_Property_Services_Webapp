"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { EButton, ECard, ECardBody } from "@/components/v2/ui/primitives";
import { ESaveStatus, ESectionHeading, useSaveStatus } from "./estate-form";

export type PortalVersionValue = "v1" | "v2";

/**
 * Picks the house look — which version of the app everyone lands in.
 *
 * Presented as two cards rather than a toggle because the two options are
 * peers, not on/off: neither is "disabled", and the label has to say what each
 * one actually is. The saved choice is highlighted, and the copy is explicit
 * that switching does not delete or hide anything.
 */
const OPTIONS: { value: PortalVersionValue; name: string; blurb: string; detail: string }[] = [
  {
    value: "v1",
    name: "Classic",
    blurb: "The original interface.",
    detail: "Portals at /admin, /cleaner, /client, /laundry, /qa, /maintenance.",
  },
  {
    value: "v2",
    name: "Estate",
    blurb: "The redesign — warmer surfaces, serif numerals, calmer navigation.",
    detail: "The same data and the same actions, at /v2/…",
  },
];

export function LookSection({
  initial,
  readOnly,
}: {
  initial: PortalVersionValue;
  readOnly?: boolean;
}) {
  const [value, setValue] = useState<PortalVersionValue>(initial);
  const [saved, setSaved] = useState<PortalVersionValue>(initial);
  const [saving, setSaving] = useState(false);
  const { status, flash } = useSaveStatus();

  async function save(next: PortalVersionValue) {
    if (readOnly || saving) return;
    setValue(next);
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultPortalVersion: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setValue(saved); // put the cards back the way they were
        flash("error", body.error ?? "Could not change the default look.");
        return;
      }
      setSaved(next);
      flash("saved", `Everyone now lands in ${next === "v2" ? "Estate" : "Classic"}`);
    } catch {
      setValue(saved);
      flash("error", "Could not change the default look.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <ESectionHeading
        eyebrow="Appearance"
        title="Default look"
        description="Which version of the app everyone lands in after signing in."
      />

      <div className="grid gap-3 sm:grid-cols-2">
        {OPTIONS.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              disabled={readOnly || saving}
              onClick={() => save(opt.value)}
              className={`rounded-[var(--e-radius)] border p-4 text-left transition disabled:opacity-60 ${
                active
                  ? "border-[hsl(var(--e-gold))] bg-[hsl(var(--e-gold-soft))]"
                  : "border-[hsl(var(--e-border-strong))] hover:bg-[hsl(var(--e-muted))]"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-[0.9375rem] font-[550]">{opt.name}</span>
                {active ? (
                  saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4 text-[hsl(var(--e-gold-ink))]" />
                  )
                ) : null}
                {opt.value === saved ? (
                  <span className="ml-auto text-[0.6875rem] uppercase tracking-wide text-[hsl(var(--e-muted-foreground))]">
                    Current
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">{opt.blurb}</p>
              <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{opt.detail}</p>
            </button>
          );
        })}
      </div>

      <ESaveStatus status={status} />

      <ECard>
        <ECardBody className="space-y-2 pt-6 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
          <p>
            <strong className="font-[550]">Nothing is switched off.</strong> Both versions stay
            fully available — this only decides where signing in, the home page and a portal&apos;s
            main page send people. Existing bookmarks and links keep working exactly where they
            point, so no one gets stranded mid-task by a change made while they were working.
          </p>
          <p>
            Anyone can override it for themselves from the account menu, and their choice sticks
            until they change it back. Use that to try the other look before switching everyone.
          </p>
        </ECardBody>
      </ECard>
    </div>
  );
}
