"use client";

/**
 * The Insights client filter as drawn: a "Client: all" chip that opens the
 * shared filter popover with a searchable list of clients. Choices come from
 * /api/admin/insights/options (the database), never from loaded rows.
 *
 * Keyboard: the search box takes focus first; ArrowDown moves into the list,
 * ArrowUp / ArrowDown move through it, Home / End jump, Enter or Space
 * chooses, Escape closes the popover (EFilterPopover) and returns focus.
 */
import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { EFilterPopover } from "@/components/v2/ui/filter-popover";
import { useQualityRead } from "@/components/v2/admin/quality/hub/use-quality-read";
import { isOptions } from "./insights-types";

export type ClientOption = { id: string; name: string };

/** Case-insensitive match on any part of the name; an empty query keeps every client. */
export function filterClients(clients: readonly ClientOption[], query: string): ClientOption[] {
  const needle = query.trim().toLocaleLowerCase("en-AU");
  if (!needle) return [...clients];
  return clients.filter((client) => client.name.toLocaleLowerCase("en-AU").includes(needle));
}

type ListProps = {
  clients: readonly ClientOption[];
  value: string;
  onChange: (clientId: string) => void;
};

function ClientList({ clients, value, onChange }: ListProps) {
  const [query, setQuery] = React.useState("");
  const listRef = React.useRef<HTMLUListElement>(null);
  const searchId = React.useId();
  const shown = filterClients(clients, query);

  function focusItem(index: number) {
    const items = listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-client-option]");
    if (!items || items.length === 0) return;
    items[Math.max(0, Math.min(items.length - 1, index))].focus();
  }

  function onListKeyDown(event: React.KeyboardEvent<HTMLUListElement>) {
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-client-option]") ?? []);
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "ArrowDown") focusItem(current + 1);
    else if (event.key === "ArrowUp") focusItem(current - 1);
    else if (event.key === "Home") focusItem(0);
    else if (event.key === "End") focusItem(items.length - 1);
    else return;
    event.preventDefault();
  }

  const option = (id: string, name: string) => (
    <li key={id || "all"}>
      <button
        type="button"
        data-client-option
        aria-pressed={value === id}
        onClick={() => onChange(id)}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-[var(--e-radius)] px-2 py-1.5 text-left text-[0.8125rem]",
          "hover:bg-[hsl(var(--e-surface-raised))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]",
          value === id && "font-[600] text-[hsl(var(--e-primary))]",
        )}
      >
        <span className="min-w-0 truncate">{name}</span>
        {value === id ? <Check aria-hidden className="h-3.5 w-3.5 shrink-0" /> : null}
      </button>
    </li>
  );

  return (
    <div className="space-y-2">
      <label htmlFor={searchId} className="block text-[0.75rem] font-[600] text-[hsl(var(--e-text-secondary))]">
        Search clients
      </label>
      <input
        id={searchId}
        type="search"
        value={query}
        autoComplete="off"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            focusItem(0);
          }
        }}
        className="h-[34px] w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2.5 text-[0.8125rem] text-[hsl(var(--e-foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--e-ring))]"
      />
      <ul ref={listRef} aria-label="Clients" onKeyDown={onListKeyDown} className="max-h-[16rem] space-y-0.5 overflow-y-auto">
        {option("", "All clients")}
        {shown.map((client) => option(client.id, client.name))}
      </ul>
      {shown.length === 0 ? (
        <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">No client matches &ldquo;{query.trim()}&rdquo;.</p>
      ) : null}
    </div>
  );
}

export function ClientFilter({ value, onChange }: { value: string; onChange: (clientId: string) => void }) {
  const options = useQualityRead("/api/admin/insights/options", isOptions, "Clients could not be loaded.");
  const clients = options.data?.clients ?? [];
  const selected = value ? clients.find((client) => client.id === value)?.name ?? "selected client" : null;
  return (
    <EFilterPopover label="Client" value={selected} emptyValue="all">
      {options.data ? (
        <ClientList clients={clients} value={value} onChange={onChange} />
      ) : options.loading ? (
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading clients…</p>
      ) : (
        <div className="space-y-2">
          <p role="alert" className="text-[0.8125rem] text-[hsl(var(--e-danger))]">
            {options.error ?? "Clients could not be loaded."}
          </p>
          <button type="button" onClick={options.reload} className="text-[0.8125rem] text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">
            Try again
          </button>
          {value ? (
            <button type="button" onClick={() => onChange("")} className="block text-[0.8125rem] text-[hsl(var(--e-primary))] underline-offset-2 hover:underline">
              Show all clients
            </button>
          ) : null}
        </div>
      )}
    </EFilterPopover>
  );
}
