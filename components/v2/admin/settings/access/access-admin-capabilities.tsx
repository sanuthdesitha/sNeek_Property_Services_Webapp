"use client";

import { ESwitch } from "@/components/v2/admin/estate-kit";
import { effectiveCapabilities } from "@/lib/rbac/access-evaluator";
import { CAPABILITIES, type CapabilityKey } from "@/lib/rbac/capabilities";
import type { OpsPolicy } from "@/lib/rbac/ops-policy";
import { SensitiveBadge } from "./access-badges";

const GRANTS = CAPABILITIES.filter((capability) => capability.tier === "grant");

/**
 * Administrator capabilities for one person (owner decision 2026-11-12):
 * off by default, granted individually by an administrator only, sensitive
 * and PIN-protected. The server refuses any use on an administrator, on
 * someone with more access, on themselves, or while testing as someone.
 */
export function AccessAdminCapabilities({
  draft,
  saved,
  userId,
  viewerIsAdmin,
  disabled,
  onToggle,
}: {
  draft: OpsPolicy;
  saved: OpsPolicy;
  userId: string;
  viewerIsAdmin: boolean;
  disabled: boolean;
  onToggle: (key: CapabilityKey, on: boolean) => void;
}) {
  const current = effectiveCapabilities(draft, userId);
  const before = effectiveCapabilities(saved, userId);
  return (
    <section aria-labelledby="access-admin-capabilities" className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4">
      <h3 id="access-admin-capabilities" className="text-[0.9375rem] font-[600]">Administrator capabilities</h3>
      <p className="mt-0.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
        Off unless an administrator grants them to this person. Each one asks for that person's own PIN, works only on people with no more access, never on administrators or themselves, and never while testing as someone.
        {viewerIsAdmin ? "" : " Only an administrator can change these."}
      </p>
      <ul className="mt-2.5 grid list-none gap-2 p-0 sm:grid-cols-2">
        {GRANTS.map((capability) => {
          const key = capability.key as CapabilityKey;
          return (
            <li key={key} className="flex items-start justify-between gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-2.5">
              <span className="text-[0.8125rem]">
                {capability.label} <SensitiveBadge />
                {current[key] !== before[key] ? <span className="block text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">Was {before[key] ? "granted" : "off"} · not saved</span> : null}
              </span>
              <ESwitch checked={current[key]} disabled={disabled || !viewerIsAdmin} onCheckedChange={(on) => onToggle(key, on)} label={<span className="sr-only">{capability.label}</span>} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
