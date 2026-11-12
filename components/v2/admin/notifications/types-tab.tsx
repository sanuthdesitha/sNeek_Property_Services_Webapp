"use client";

import * as React from "react";
import { EDataTable, type EDataColumn } from "@/components/v2/ui/data-table";
import { EFilterChips } from "@/components/v2/ui/filter-chips";
import { EPill, type EPillTone } from "@/components/v2/ui/pill";
import { EAlert } from "@/components/v2/ui/primitives";
import { PATH_LABEL, TRANSPORT_LABEL, type CatalogGroup, type NotificationPath, type PreferenceMode } from "@/lib/notifications/catalog-types";
import type { CatalogResponse, CatalogTypeView } from "@/lib/notifications/catalog-view-types";
import { useNotificationRead } from "./use-notification-read";
import { TypePanel } from "./type-panel";

const GROUPS: Array<CatalogGroup | "all"> = ["all", "Jobs", "Cleaners", "Clients", "Office alerts", "Laundry", "Stock", "Money", "Accounts", "Workforce", "Leads & marketing"];

const PATH_TONE: Record<NotificationPath, EPillTone> = { PIPELINE: "ok", PIPELINE_WITH_FALLBACK: "info", DIRECT: "neutral", NO_PRODUCER: "warn" };
export const PREFERENCE_LABEL: Record<PreferenceMode, string> = {
  RESPECTS: "Yes",
  IGNORES: "No (office-directed)",
  ADMIN_SWITCH: "Admin switch",
  EMAIL_GATES_ONLY: "Email settings only",
};

function parseCatalog(body: unknown): CatalogResponse {
  const value = body as Partial<CatalogResponse> | null;
  if (!value || !Array.isArray(value.types)) throw new Error("bad catalog");
  return { types: value.types, controlsUpdatedAt: value.controlsUpdatedAt ?? null };
}

function TransportCell({ type }: { type: CatalogTypeView }) {
  return (
    <div className="flex flex-wrap gap-1">
      {type.transports.map((transport) => {
        const off = type.disabledTransports.includes(transport);
        const byDefault = type.defaultTransports.includes(transport);
        return (
          <EPill key={transport} tone={off ? "bad" : byDefault ? "ok" : "neutral"}>
            {TRANSPORT_LABEL[transport]}{off ? " (off)" : byDefault ? "" : " (optional)"}
          </EPill>
        );
      })}
      {type.transports.length === 0 ? <span className="text-xs text-[hsl(var(--e-muted-foreground))]">None</span> : null}
    </div>
  );
}

function preferenceText(type: CatalogTypeView): string {
  if (type.preferences === "ADMIN_SWITCH") return type.respectsPreferencesNow ? "Yes (admin switch)" : "No (admin switch)";
  return PREFERENCE_LABEL[type.preferences];
}

export function TypesTab({ isAdmin, readOnly }: { isAdmin: boolean; readOnly: boolean }) {
  const read = useNotificationRead("/api/admin/notifications/catalog", parseCatalog, "Could not load notification types.");
  const [group, setGroup] = React.useState<CatalogGroup | "all">("all");
  const [openKey, setOpenKey] = React.useState<string | null>(null);
  const [override, setOverride] = React.useState<CatalogResponse | null>(null);
  const catalog = override ?? read.data;
  React.useEffect(() => setOverride(null), [read.data]);

  const rows = (catalog?.types ?? []).filter((type) => group === "all" || type.group === group);
  const open = catalog?.types.find((type) => type.key === openKey) ?? null;
  const counts = new Map<string, number>();
  for (const type of catalog?.types ?? []) counts.set(type.group, (counts.get(type.group) ?? 0) + 1);

  const columns: Array<EDataColumn<CatalogTypeView>> = [
    { key: "name", header: "Notification", cell: (type) => (
      <button type="button" className="text-left font-medium text-[hsl(var(--e-foreground))] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[hsl(var(--e-ring))]" onClick={() => setOpenKey(type.key)}>
        {type.name}
      </button>
    ) },
    { key: "trigger", header: "Trigger", className: "max-w-[18rem]", cell: (type) => <span className="line-clamp-2 text-xs">{type.trigger}</span> },
    { key: "audience", header: "Audience", className: "max-w-[14rem]", cell: (type) => <span className="line-clamp-2 text-xs">{type.audience}</span> },
    { key: "transports", header: "Transports", cell: (type) => <TransportCell type={type} /> },
    { key: "path", header: "Path", cell: (type) => <EPill tone={PATH_TONE[type.path]}>{PATH_LABEL[type.path]}</EPill> },
    { key: "template", header: "Template", cell: (type) => (type.templateHref ? <a className="text-xs underline" href={type.templateHref}>Edit template</a> : <span className="text-xs text-[hsl(var(--e-muted-foreground))]">Written in code</span>) },
    { key: "prefs", header: "Respects personal preferences", cell: (type) => <span className="text-xs">{preferenceText(type)}</span> },
  ];

  return (
    <section aria-labelledby="notification-types-heading" className="space-y-4">
      <div className="space-y-1">
        <h2 id="notification-types-heading" className="text-lg font-semibold">Notification types</h2>
        <p className="text-sm text-[hsl(var(--e-muted-foreground))]">
          Every notification the system can send, who receives it and how. Open a type to see its recipients rule, switches and last deliveries.
        </p>
      </div>
      <EFilterChips
        label="Notification group"
        chips={GROUPS.map((key) => ({ key, label: key === "all" ? "All" : key, count: key === "all" ? catalog?.types.length ?? null : counts.get(key) ?? 0 }))}
        active={group}
        onChange={setGroup}
      />
      {read.error && catalog ? <EAlert tone="warning" title="Showing the last loaded list">{read.error}</EAlert> : null}
      <EDataTable
        label="Notification types"
        columns={columns}
        rows={rows}
        rowKey={(type) => type.key}
        loading={read.loading}
        error={read.error}
        onRetry={read.reload}
        emptyTitle="No notification types in this group"
        onRowClick={(type) => setOpenKey(type.key)}
        activeRowKey={openKey}
        minWidth="68rem"
      />
      {open && catalog ? (
        <TypePanel
          key={open.key}
          type={open}
          controlsUpdatedAt={catalog.controlsUpdatedAt}
          isAdmin={isAdmin}
          readOnly={readOnly}
          onClose={() => setOpenKey(null)}
          onCatalogChange={setOverride}
        />
      ) : null}
    </section>
  );
}
