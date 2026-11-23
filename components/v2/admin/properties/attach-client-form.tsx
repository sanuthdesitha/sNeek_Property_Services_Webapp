"use client";

/**
 * Attach a one-off site that is still under "Unassigned / One-off Jobs" to its
 * real client (POST /api/admin/properties/[id]/attach-client). Mounted only
 * when the office opens it, so the client list is read lazily. The choice is
 * kept after a refusal and the controls are frozen while saving. Keyed by the
 * site by its callers, so another site starts empty.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { EButton } from "@/components/v2/ui/primitives";
import { EField, ESelect } from "@/components/v2/admin/estate-kit";

type ClientOption = { id: string; name: string; isActive: boolean };

type ListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; clients: ClientOption[] };

type SaveState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "error"; message: string }
  | { status: "done"; message: string };

const FALLBACK_NAME = "Unassigned / One-off Jobs";

function readClients(body: unknown): ClientOption[] {
  if (!Array.isArray(body)) return [];
  return body
    .filter((row): row is { id: string; name: string; isActive?: boolean } => Boolean(row) && typeof (row as { id?: unknown }).id === "string" && typeof (row as { name?: unknown }).name === "string")
    .filter((row) => row.name.trim() !== FALLBACK_NAME && row.isActive !== false)
    .map((row) => ({ id: row.id, name: row.name, isActive: row.isActive !== false }));
}

export function AttachClientForm({
  propertyId,
  siteName,
  jobCount,
  expectedUpdatedAt,
}: {
  propertyId: string;
  siteName: string;
  /** Jobs at the site that move with it. */
  jobCount: number;
  /** The site's updatedAt as loaded (stale-write guard). */
  expectedUpdatedAt: string;
}) {
  const router = useRouter();
  const [list, setList] = React.useState<ListState>({ status: "loading" });
  const [clientId, setClientId] = React.useState("");
  const [save, setSave] = React.useState<SaveState>({ status: "idle" });
  const saving = save.status === "saving";

  React.useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch("/api/admin/clients", { cache: "no-store", signal: controller.signal });
        const body: unknown = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!response.ok) {
          setList({ status: "error", message: (body as { error?: string } | null)?.error ?? "The client list could not be read." });
          return;
        }
        setList({ status: "ready", clients: readClients(body) });
      } catch {
        if (!controller.signal.aborted) setList({ status: "error", message: "The client list could not be read. Check the connection and open this again." });
      }
    })();
    return () => controller.abort();
  }, [propertyId]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!clientId || saving) return;
    setSave({ status: "saving" });
    try {
      const response = await fetch(`/api/admin/properties/${encodeURIComponent(propertyId)}/attach-client`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, expectedUpdatedAt }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;
      if (!response.ok) {
        setSave({ status: "error", message: response.status === 403 ? "Your access does not allow changing properties." : body?.error ?? "The client was not attached." });
        return;
      }
      setSave({ status: "done", message: body?.message ?? "Attached." });
      router.refresh();
    } catch {
      setSave({ status: "error", message: "No answer from the server. It may not have been saved; reload to see what is stored." });
    }
  }

  if (save.status === "done") {
    return <p role="status" className="text-[0.8125rem] text-[hsl(var(--e-success))]">{save.message}</p>;
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
        {siteName} is filed under “{FALLBACK_NAME}”, so its {jobCount === 1 ? "job" : `${jobCount} jobs`} cannot be invoiced to anyone or seen by the client. Attaching moves the site and every job at it to the client you choose.
      </p>
      <fieldset disabled={saving} className="space-y-3">
        {list.status === "loading" ? <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading clients…</p> : null}
        {list.status === "error" ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{list.message}</p> : null}
        {list.status === "ready" && list.clients.length === 0 ? (
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">There are no active clients to choose. Add the client first.</p>
        ) : null}
        {list.status === "ready" && list.clients.length > 0 ? (
          <EField label="Client" hint="Only a one-off site still under “Unassigned / One-off Jobs” can be attached. It is not moved between real clients.">
            <ESelect value={clientId} onChange={(event) => setClientId(event.target.value)} className="max-sm:text-[16px]">
              <option value="">Choose the client…</option>
              {list.clients.map((client) => (
                <option key={client.id} value={client.id}>{client.name}</option>
              ))}
            </ESelect>
          </EField>
        ) : null}
        {save.status === "error" ? <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">{save.message}</p> : null}
        <EButton type="submit" size="sm" variant="primary" disabled={!clientId || saving || list.status !== "ready"} className="max-sm:h-11">
          {saving ? "Attaching…" : "Attach to client"}
        </EButton>
      </fieldset>
    </form>
  );
}

/**
 * "Attach to client" as a lazy disclosure for lists (the client page's one-off
 * sites): the form, and its client-list read, mount on first open and stay
 * mounted when collapsed so a chosen client survives closing it.
 */
export function AttachClientDisclosure(props: React.ComponentProps<typeof AttachClientForm>) {
  const [open, setOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const panelId = React.useId();
  return (
    <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] px-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((value) => !value);
          setMounted(true);
        }}
        className="flex min-h-11 w-full items-center text-left text-[0.8125rem] font-[550] sm:min-h-9"
      >
        {open ? "Hide attach to client" : "Attach to client"}
      </button>
      <div id={panelId} hidden={!open} className="pb-3">
        {mounted ? <AttachClientForm {...props} /> : null}
      </div>
    </div>
  );
}
