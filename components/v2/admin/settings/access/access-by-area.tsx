"use client";

import { useState } from "react";
import { OPS_FEATURES, type AccessLevel, type OpsFeature } from "@/lib/rbac/ops-catalog";
import { resolveAccessLevels, type OpsPolicy } from "@/lib/rbac/ops-policy";
import { isAdminPerson, type AccessPerson } from "@/lib/rbac/access-screen-types";
import { AccessLevelControl } from "./access-level-control";
import { displayName, firstName, plainLabel } from "./access-labels";
import { AccessLevelSheetButton } from "./access-phone";
import { useIsPhone } from "@/components/v2/ui/use-phone";

/** One area across everyone: who has Off, View, Manage or Full. Edits join the same draft. */
export function AccessByArea({
  people,
  draft,
  saved,
  editable,
  onLevel,
}: {
  people: AccessPerson[];
  draft: OpsPolicy;
  saved: OpsPolicy;
  editable: (person: AccessPerson) => boolean;
  onLevel: (userId: string, area: OpsFeature, level: AccessLevel) => void;
}) {
  const phone = useIsPhone();
  const [area, setArea] = useState<OpsFeature>("jobs");
  const feature = OPS_FEATURES.find((item) => item.key === area);
  return (
    <section aria-labelledby="access-by-area-title" className="flex flex-col gap-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4">
      <h2 id="access-by-area-title" className="text-[1rem] font-[600]">By area</h2>
      <label className="flex flex-col gap-1 text-[0.75rem] font-[550] text-[hsl(var(--e-text-secondary))]">
        Area
        <select className="min-h-10 max-w-sm rounded-[var(--e-radius)] border border-[hsl(var(--e-input))] bg-[hsl(var(--e-surface))] px-3 text-base sm:text-[0.875rem]" value={area} onChange={(event) => setArea(event.target.value as OpsFeature)}>
          {OPS_FEATURES.map((item) => <option key={item.key} value={item.key}>{plainLabel(item.label)}</option>)}
        </select>
      </label>
      {feature ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{feature.description}</p> : null}
      <ul className="m-0 list-none divide-y divide-[hsl(var(--e-border))] p-0">
        {people.map((person) => (
          <li key={person.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="text-[0.875rem]">{displayName(person)}</span>
            {isAdminPerson(person) ? (
              <span className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Full (administrator)</span>
            ) : phone ? (
              <AccessLevelSheetButton
                value={resolveAccessLevels(draft, person.id)[area]}
                saved={resolveAccessLevels(saved, person.id)[area]}
                label={`${displayName(person)}, ${plainLabel(feature?.label ?? area)}`}
                title={displayName(person)}
                description={plainLabel(feature?.label ?? area)}
                personName={firstName(person)}
                disabled={!editable(person)}
                onChange={(level) => onLevel(person.id, area, level)}
              />
            ) : (
              <AccessLevelControl
                value={resolveAccessLevels(draft, person.id)[area]}
                saved={resolveAccessLevels(saved, person.id)[area]}
                label={`${displayName(person)}, ${plainLabel(feature?.label ?? area)}`}
                disabled={!editable(person)}
                onChange={(level) => onLevel(person.id, area, level)}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
