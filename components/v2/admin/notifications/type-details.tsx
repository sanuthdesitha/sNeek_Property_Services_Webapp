"use client";

import * as React from "react";
import { EPill } from "@/components/v2/ui/pill";
import { EAlert, EButton } from "@/components/v2/ui/primitives";
import { ESwitch } from "@/components/v2/admin/estate-kit";
import { PATH_LABEL, TRANSPORT_LABEL, type NotificationTransport } from "@/lib/notifications/catalog-types";
import type { CatalogTypeView, ResolvedSwitch } from "@/lib/notifications/catalog-view-types";
import { audienceGroup } from "@/lib/notifications/wording/audience-groups";
import { WORDING_STATUS_LABEL, type WordingStatus } from "@/lib/notifications/wording/types";
import type { WordingSummary } from "@/lib/notifications/wording/view-types";
import { RecentDeliveries } from "./recent-deliveries";

const INITIATOR: Record<CatalogTypeView["initiator"], string> = {
  AUTOMATIC: "automatic",
  SCHEDULED: "scheduled",
  PERSON_ACTION: "a person's action",
  OFFICE_MANUAL: "sent by the office",
};

type Props = {
  type: CatalogTypeView;
  summary: WordingSummary | undefined;
  controlsUpdatedAt: string | null;
  canSwitch: boolean;
  switchNote: string | null;
  saving: boolean;
  error: string | null;
  onSave: (body: unknown) => void;
  timeZone: string;
};

function switchChange(item: ResolvedSwitch, enabled: boolean): unknown {
  const [kind, key] = item.id.split(":");
  return kind === "email" ? { existingSwitch: { kind: "EMAIL_KIND", emailKind: key, enabled } } : { existingSwitch: { kind: "SCHEDULED", setting: key, enabled } };
}

function statusBadge(summary: WordingSummary | undefined) {
  if (!summary) return null;
  const status = summary.status as WordingStatus;
  if (summary.edited) return <EPill tone="gold">{`Edited · v${summary.liveVersion}`}</EPill>;
  return <EPill tone={status === "IN_CODE" ? "neutral" : "info"}>{WORDING_STATUS_LABEL[status]}</EPill>;
}

export function TypeDetails({ type, summary, controlsUpdatedAt, canSwitch, switchNote, saving, error, onSave, timeZone }: Props) {
  const [moreOpen, setMoreOpen] = React.useState(false);
  const moreId = React.useId();
  const hasTypeControl = type.switches.some((item) => item.kind === "TYPE_CONTROL");

  function toggleTransport(transport: NotificationTransport, on: boolean) {
    const next = on ? type.disabledTransports.filter((item) => item !== transport) : [...type.disabledTransports, transport];
    onSave({ controls: { expectedUpdatedAt: controlsUpdatedAt, disabledTransports: { [type.key]: next } } });
  }

  return (
    <div className="flex flex-col gap-2 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--e-muted-foreground))]">{audienceGroup(type)} · {INITIATOR[type.initiator]}</p>
          <h2 id="notification-type-heading" className="e-display-sm break-words text-xl">{type.name}</h2>
        </div>
        <div className="flex items-center gap-2">
          {statusBadge(summary)}
          <EButton variant="ghost" size="sm" aria-expanded={moreOpen} aria-controls={moreId} aria-label="More about this notification" onClick={() => setMoreOpen((open) => !open)}>⋯</EButton>
        </div>
      </div>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[120px_minmax(0,1fr)]">
        <dt className="text-[hsl(var(--e-muted-foreground))]">When</dt><dd>{type.trigger}</dd>
        <dt className="text-[hsl(var(--e-muted-foreground))]">Who receives it</dt><dd>{type.audience}</dd>
        {type.preferences === "ADMIN_SWITCH" ? (
          <>
            <dt className="text-[hsl(var(--e-muted-foreground))]">Preferences</dt>
            <dd>
              <ESwitch checked={type.respectsPreferencesNow === true} disabled={!canSwitch || saving} onCheckedChange={(on) => onSave({ controls: { expectedUpdatedAt: controlsUpdatedAt, respectsPreferences: { [type.key]: on } } })} label="Respect each person's own notification choices" />
            </dd>
          </>
        ) : null}
      </dl>
      {type.notes ? <p className="text-xs text-[hsl(var(--e-muted-foreground))]">{type.notes}</p> : null}
      {switchNote ? <p className="text-xs text-[hsl(var(--e-muted-foreground))]">{switchNote}</p> : null}
      {saving ? <p role="status" className="text-xs">Saving the switch…</p> : null}
      {error ? <EAlert tone="danger" title="Switch not changed">{error}</EAlert> : null}

      <div id={moreId} hidden={!moreOpen} className="space-y-4 border-t border-[hsl(var(--e-border))] pt-3 text-sm">
        <section aria-labelledby={`${moreId}-transports`} className="space-y-2">
          <h3 id={`${moreId}-transports`} className="font-semibold">Transports and switches <EPill tone="neutral">{PATH_LABEL[type.path]}</EPill></h3>
          <ul className="space-y-2">
            {type.transports.map((transport) => {
              const off = type.disabledTransports.includes(transport);
              const path = transport === "EMAIL" || transport === "SMS" || transport === "WEB_PUSH" ? type.externalPaths[transport] : undefined;
              return (
                <li key={transport} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{TRANSPORT_LABEL[transport]} {path ? <EPill tone={path === "pipeline" ? "ok" : "info"}>{path === "pipeline" ? "pipeline" : "direct path"}</EPill> : null}</span>
                  {hasTypeControl ? <ESwitch checked={!off} disabled={!canSwitch || saving} onCheckedChange={(on) => toggleTransport(transport, on)} label={<span className="sr-only">{`${TRANSPORT_LABEL[transport]} for ${type.name}`}</span>} /> : null}
                </li>
              );
            })}
            {type.resolvedSwitches.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>{item.label}{item.note ? <span className="block text-xs text-[hsl(var(--e-muted-foreground))]">{item.note}</span> : null}</span>
                {item.editable && item.enabled !== null ? (
                  <ESwitch checked={item.enabled} disabled={!canSwitch || saving} onCheckedChange={(on) => onSave(switchChange(item, on))} label={<span className="sr-only">{item.label}</span>} />
                ) : item.href ? <a className="text-xs underline" href={item.href}>Open</a> : null}
              </li>
            ))}
          </ul>
          {!hasTypeControl && type.resolvedSwitches.length === 0 ? <p className="text-xs text-[hsl(var(--e-muted-foreground))]">No switch exists for this type: it goes out when its trigger happens (audience channel controls in Preferences still apply where noted).</p> : null}
        </section>
        {moreOpen ? <RecentDeliveries typeKey={type.key} timeZone={timeZone} /> : null}
        <details>
          <summary className="min-h-9 cursor-pointer text-xs">Source files ({type.producers.length})</summary>
          <ul className="mt-1 space-y-0.5 text-xs [overflow-wrap:anywhere]">{type.producers.map((file) => <li key={file}><code>{file}</code></li>)}</ul>
        </details>
      </div>
    </div>
  );
}
