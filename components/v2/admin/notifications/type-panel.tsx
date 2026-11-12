"use client";

import * as React from "react";
import { ESidePanel } from "@/components/v2/ui/side-panel";
import { EPill } from "@/components/v2/ui/pill";
import { EAlert, EButton } from "@/components/v2/ui/primitives";
import { ESwitch } from "@/components/v2/admin/estate-kit";
import { PATH_LABEL, TRANSPORT_LABEL, type NotificationTransport } from "@/lib/notifications/catalog-types";
import type { CatalogResponse, CatalogTypeView, ResolvedSwitch } from "@/lib/notifications/catalog-view-types";
import { sendJson } from "./use-notification-read";
import { RecentDeliveries } from "./recent-deliveries";
import { TestSendBox } from "./test-send-box";

const INITIATOR: Record<CatalogTypeView["initiator"], string> = {
  AUTOMATIC: "Automatic (an event in the system)",
  SCHEDULED: "Scheduled by the worker",
  PERSON_ACTION: "Something a person does",
  OFFICE_MANUAL: "An office user sends it",
};

type Props = {
  type: CatalogTypeView;
  controlsUpdatedAt: string | null;
  isAdmin: boolean;
  readOnly: boolean;
  onClose: () => void;
  onCatalogChange: (next: CatalogResponse) => void;
};

function switchChange(item: ResolvedSwitch, enabled: boolean): unknown {
  const [kind, key] = item.id.split(":");
  return kind === "email" ? { existingSwitch: { kind: "EMAIL_KIND", emailKind: key, enabled } } : { existingSwitch: { kind: "SCHEDULED", setting: key, enabled } };
}

export function TypePanel({ type, controlsUpdatedAt, isAdmin, readOnly, onClose, onCatalogChange }: Props) {
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const canEdit = isAdmin && !readOnly;
  const hasTypeControl = type.switches.some((item) => item.kind === "TYPE_CONTROL");

  async function save(body: unknown) {
    if (saving) return;
    setSaving(true);
    setError(null);
    const result = await sendJson("/api/admin/notifications/catalog", "PATCH", body);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onCatalogChange(result.body as CatalogResponse);
  }

  function toggleTransport(transport: NotificationTransport, on: boolean) {
    const next = on ? type.disabledTransports.filter((item) => item !== transport) : [...type.disabledTransports, transport];
    void save({ controls: { expectedUpdatedAt: controlsUpdatedAt, disabledTransports: { [type.key]: next } } });
  }

  return (
    <ESidePanel open title={type.name} label="Notification type" subtitle={`${type.group} · ${PATH_LABEL[type.path]}`} onClose={onClose}>
      <div className="space-y-5 text-sm">
        <section aria-label="What it is" className="space-y-2">
          <p><span className="font-medium">Trigger: </span>{type.trigger}</p>
          <p><span className="font-medium">Who receives it: </span>{type.audience}</p>
          <p><span className="font-medium">Started by: </span>{INITIATOR[type.initiator]}</p>
          {type.notes ? <p className="text-[hsl(var(--e-muted-foreground))]">{type.notes}</p> : null}
          {type.templateHref ? <a className="inline-block underline" href={type.templateHref}>Edit its template</a> : <p className="text-xs text-[hsl(var(--e-muted-foreground))]">Its wording is written in code.</p>}
        </section>

        <section aria-labelledby="type-transports" className="space-y-2">
          <h3 id="type-transports" className="font-semibold">Transports</h3>
          <ul className="space-y-2">
            {type.transports.map((transport) => {
              const off = type.disabledTransports.includes(transport);
              const path = transport === "EMAIL" || transport === "SMS" || transport === "WEB_PUSH" ? type.externalPaths[transport] : undefined;
              return (
                <li key={transport} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {TRANSPORT_LABEL[transport]}{" "}
                    {path ? <EPill tone={path === "pipeline" ? "ok" : "info"}>{path === "pipeline" ? "pipeline" : "direct path"}</EPill> : null}
                  </span>
                  {hasTypeControl ? (
                    <ESwitch checked={!off} disabled={!canEdit || saving} onCheckedChange={(on) => toggleTransport(transport, on)} label={<span className="sr-only">{`${TRANSPORT_LABEL[transport]} for ${type.name}`}</span>} />
                  ) : null}
                </li>
              );
            })}
          </ul>
          {!hasTypeControl ? <p className="text-xs text-[hsl(var(--e-muted-foreground))]">Transports follow the switches below and the audience channel controls in Preferences.</p> : null}
        </section>

        <section aria-labelledby="type-switches" className="space-y-2">
          <h3 id="type-switches" className="font-semibold">Switches</h3>
          {type.resolvedSwitches.length === 0 && !hasTypeControl ? <p className="text-xs text-[hsl(var(--e-muted-foreground))]">No switch exists for this type: it always goes out when its trigger happens (audience channel controls in Preferences still apply where noted).</p> : null}
          <ul className="space-y-2">
            {type.resolvedSwitches.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>{item.label}{item.note ? <span className="block text-xs text-[hsl(var(--e-muted-foreground))]">{item.note}</span> : null}</span>
                {item.editable && item.enabled !== null ? (
                  <ESwitch checked={item.enabled} disabled={!canEdit || saving} onCheckedChange={(on) => void save(switchChange(item, on))} label={<span className="sr-only">{item.label}</span>} />
                ) : item.href ? <a className="text-xs underline" href={item.href}>Open</a> : null}
              </li>
            ))}
            {type.preferences === "ADMIN_SWITCH" ? (
              <li className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  Respect each person&apos;s notification preferences
                  <span className="block text-xs text-[hsl(var(--e-muted-foreground))]">Off (the default) sends to everyone in the recipient rule, as before. On applies personal category preferences and audience channel controls.</span>
                </span>
                <ESwitch checked={type.respectsPreferencesNow === true} disabled={!canEdit || saving} onCheckedChange={(on) => void save({ controls: { expectedUpdatedAt: controlsUpdatedAt, respectsPreferences: { [type.key]: on } } })} label={<span className="sr-only">Respect personal preferences for {type.name}</span>} />
              </li>
            ) : null}
          </ul>
          {!isAdmin ? <p className="text-xs text-[hsl(var(--e-muted-foreground))]">Only administrators can change switches.</p> : readOnly ? <p className="text-xs">Switches are read-only while impersonating.</p> : null}
          {saving ? <p role="status" className="text-xs">Saving…</p> : null}
          {error ? <EAlert tone="danger" title="Not saved">{error}</EAlert> : null}
        </section>

        {type.testable ? <TestSendBox typeKey={type.key} readOnly={readOnly} /> : null}

        <RecentDeliveries typeKey={type.key} />

        <details>
          <summary className="min-h-9 cursor-pointer text-xs">Source files ({type.producers.length})</summary>
          <ul className="mt-1 space-y-0.5 text-xs [overflow-wrap:anywhere]">{type.producers.map((file) => <li key={file}><code>{file}</code></li>)}</ul>
        </details>
        <EButton variant="outline" size="sm" onClick={onClose}>Close</EButton>
      </div>
    </ESidePanel>
  );
}
