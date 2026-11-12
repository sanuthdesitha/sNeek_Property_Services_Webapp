"use client";

import { useState } from "react";
import { EButton } from "@/components/v2/ui/primitives";
import { createPreset, deletePreset, presetUsers, setPresetLevel, updatePreset } from "@/lib/rbac/access-draft";
import { OPS_FEATURES, type AccessLevel } from "@/lib/rbac/ops-catalog";
import { listPresets, type OpsPolicy } from "@/lib/rbac/ops-policy";
import { AccessBadge } from "./access-badges";
import { AccessLevelControl } from "./access-level-control";
import { plainLabel } from "./access-labels";

const input = "min-h-10 w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 text-base sm:text-[0.875rem]";

/**
 * Presets ("Start from"): built-in ones are fixed; custom ones are edited
 * here by administrators. Editing a preset changes everyone who starts from
 * it, except their own switches. Saved with the same review and PIN.
 */
export function AccessPresetsTab({
  draft,
  saved,
  selectedPersonId,
  editable,
  onChange,
}: {
  draft: OpsPolicy;
  saved: OpsPolicy;
  selectedPersonId: string | null;
  editable: boolean;
  onChange: (next: OpsPolicy) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const presets = listPresets(draft);
  const savedPreset = (id: string) => saved.presets.find((preset) => preset.id === id);
  return (
    <section aria-labelledby="access-presets-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="access-presets-title" className="text-[1rem] font-[600]">Presets</h2>
        {editable ? (
          <div className="flex flex-wrap gap-2">
            <EButton size="sm" variant="outline" disabled={draft.presets.length >= 100} onClick={() => { const made = createPreset(draft, "New preset", null); onChange(made.policy); setOpenId(made.id); }}>New preset</EButton>
            {selectedPersonId ? (
              <EButton size="sm" variant="outline" disabled={draft.presets.length >= 100} onClick={() => { const made = createPreset(draft, "New preset", selectedPersonId); onChange(made.policy); setOpenId(made.id); }}>New from selected person</EButton>
            ) : null}
          </div>
        ) : null}
      </div>
      {!editable ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Only administrators can create or change presets.</p> : null}
      <ul className="m-0 grid list-none gap-2 p-0">
        {presets.map((preset) => {
          const users = presetUsers(draft, preset.id).length;
          const on = OPS_FEATURES.filter((feature) => (preset.levels[feature.key] ?? "off") !== "off").length;
          const custom = draft.presets.find((item) => item.id === preset.id);
          const open = openId === preset.id && custom !== undefined;
          return (
            <li key={preset.id} className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <b>{preset.name}</b> {preset.builtIn ? <AccessBadge>Built in</AccessBadge> : null} {preset.audience === "assistant" ? <AccessBadge tone="gold">Office assistant</AccessBadge> : null}
                  <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{preset.description || "No description"} · {on} of {OPS_FEATURES.length} areas on · {users} {users === 1 ? "person" : "people"}</span>
                </div>
                {custom && editable ? (
                  <div className="flex gap-2">
                    <EButton size="sm" variant="outline" aria-expanded={open} onClick={() => setOpenId(open ? null : preset.id)}>{open ? "Close" : "Edit"}</EButton>
                    <EButton size="sm" variant="outline" disabled={users > 0} title={users > 0 ? "Move people to another preset first" : undefined} onClick={() => onChange(deletePreset(draft, preset.id))}>Remove</EButton>
                  </div>
                ) : null}
              </div>
              {open && custom ? (
                <div className="mt-3 grid gap-3">
                  <label className="grid gap-1 text-[0.75rem] font-[550]">Name<input className={input} maxLength={80} value={custom.name} onChange={(event) => onChange(updatePreset(draft, custom.id, { name: event.target.value }))} /></label>
                  <label className="grid gap-1 text-[0.75rem] font-[550]">Description<input className={input} maxLength={300} value={custom.description} onChange={(event) => onChange(updatePreset(draft, custom.id, { description: event.target.value }))} /></label>
                  <label className="flex items-center gap-2 text-[0.8125rem]">
                    <input type="checkbox" checked={custom.audience === "assistant"} onChange={(event) => onChange(updatePreset(draft, custom.id, { audience: event.target.checked ? "assistant" : "manager" }))} />
                    People who start from this are office assistants
                  </label>
                  <ul className="m-0 grid list-none gap-1.5 p-0">
                    {OPS_FEATURES.map((feature) => (
                      <li key={feature.key} className="flex flex-wrap items-center justify-between gap-2 text-[0.8125rem]">
                        {plainLabel(feature.label)}
                        <AccessLevelControl
                          value={(custom.levels[feature.key] ?? "off") as AccessLevel}
                          saved={(savedPreset(custom.id)?.levels[feature.key] ?? "off") as AccessLevel}
                          label={`${custom.name}, ${plainLabel(feature.label)}`}
                          onChange={(level) => onChange(setPresetLevel(draft, custom.id, feature.key, level))}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
