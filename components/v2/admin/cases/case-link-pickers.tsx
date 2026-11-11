"use client";

/**
 * Search pickers for linking a new case to a job, property or client, using
 * existing endpoints: /api/jobs?search= (paginated), /api/admin/properties and
 * /api/admin/clients?q=. Obsolete searches are aborted. The server validates
 * whatever is chosen (it must exist and agree).
 */
import * as React from "react";
import { EField, EInput, ESelect } from "@/components/v2/admin/estate-kit";
import { EButton } from "@/components/v2/ui/primitives";

export type PickedJob = { id: string; label: string; propertyId: string | null; clientId: string | null };
export type PickedOption = { id: string; label: string; clientId?: string | null };

type JobRow = {
  id: string;
  jobNumber?: string | null;
  scheduledDate?: string | null;
  propertyId?: string | null;
  property?: { name?: string | null; client?: { id?: string } | null } | null;
};

function useSearch<T>(url: string | null): { rows: T[]; status: "idle" | "loading" | "error" | "done" } {
  const [rows, setRows] = React.useState<T[]>([]);
  const [status, setStatus] = React.useState<"idle" | "loading" | "error" | "done">("idle");
  React.useEffect(() => {
    if (!url) {
      setRows([]);
      setStatus("idle");
      return;
    }
    const controller = new AbortController();
    setStatus("loading");
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        const body: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error("search failed");
        const list = Array.isArray(body) ? body : Array.isArray((body as { jobs?: unknown })?.jobs) ? (body as { jobs: unknown[] }).jobs : [];
        setRows(list as T[]);
        setStatus("done");
      } catch {
        if (!controller.signal.aborted) setStatus("error");
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [url]);
  return { rows, status };
}

export function JobPicker({ value, onChange }: { value: PickedJob | null; onChange: (job: PickedJob | null) => void }) {
  const [query, setQuery] = React.useState("");
  const url = query.trim().length >= 2 ? `/api/jobs?paginated=1&limit=10&search=${encodeURIComponent(query.trim())}` : null;
  const { rows, status } = useSearch<JobRow>(url);
  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 text-[0.875rem]">
        <span className="min-w-0 truncate">Job: {value.label}</span>
        <EButton size="sm" variant="ghost" onClick={() => onChange(null)}>Remove</EButton>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <EField label="Link a job (optional)" hint="Search by job number or property name.">
        <EInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="e.g. J-1031" />
      </EField>
      {status === "loading" ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Searching…</p> : null}
      {status === "error" ? <p role="alert" className="text-[0.75rem] text-[hsl(var(--e-danger))]">Job search failed.</p> : null}
      {status === "done" && rows.length === 0 ? <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">No matching jobs.</p> : null}
      {rows.length > 0 ? (
        <ul className="max-h-40 overflow-y-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))]">
          {rows.slice(0, 10).map((row) => {
            const label = [row.jobNumber ?? "Job", row.property?.name, row.scheduledDate?.slice(0, 10)].filter(Boolean).join(" · ");
            return (
              <li key={row.id}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left text-[0.8125rem] hover:bg-[hsl(var(--e-muted))]"
                  onClick={() => onChange({ id: row.id, label, propertyId: row.propertyId ?? null, clientId: row.property?.client?.id ?? null })}
                >
                  {label}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

type PropertyRow = { id: string; name: string; suburb?: string | null; client?: { id: string; name: string } | null };
type ClientRow = { id: string; name: string; email?: string | null };

export function PropertyClientPickers({
  propertyId,
  clientId,
  lockedByJob,
  onProperty,
  onClient,
}: {
  propertyId: string;
  clientId: string;
  lockedByJob: boolean;
  onProperty: (option: PickedOption | null) => void;
  onClient: (id: string) => void;
}) {
  const properties = useSearch<PropertyRow>("/api/admin/properties");
  const clients = useSearch<ClientRow>("/api/admin/clients");
  const shownProperties = clientId ? properties.rows.filter((row) => !row.client || row.client.id === clientId) : properties.rows;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <EField label="Client (optional)" hint={properties.status === "error" || clients.status === "error" ? "Could not load the list." : undefined}>
        <ESelect value={clientId} disabled={lockedByJob} onChange={(event) => onClient(event.target.value)}>
          <option value="">Not linked</option>
          {clients.rows.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
        </ESelect>
      </EField>
      <EField label="Property (optional)">
        <ESelect
          value={propertyId}
          disabled={lockedByJob}
          onChange={(event) => {
            const row = properties.rows.find((item) => item.id === event.target.value);
            onProperty(row ? { id: row.id, label: row.name, clientId: row.client?.id ?? null } : null);
          }}
        >
          <option value="">Not linked</option>
          {shownProperties.map((row) => <option key={row.id} value={row.id}>{row.name}{row.suburb ? `, ${row.suburb}` : ""}</option>)}
        </ESelect>
      </EField>
    </div>
  );
}
