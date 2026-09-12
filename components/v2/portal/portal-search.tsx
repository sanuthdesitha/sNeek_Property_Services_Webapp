"use client";

import * as React from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { useSession } from "next-auth/react";
import { Search, X } from "lucide-react";
import { z } from "zod";

function localDestination(href: string) {
  if (!/^\/v2\/(admin|client|cleaner|qa|laundry|maintenance)(\/|\?|$)/.test(href)) return false;
  try {
    return !/[\\\s\u0000-\u001f\u007f]/.test(decodeURIComponent(href))
      && new URL(href, "https://portal.invalid").origin === "https://portal.invalid";
  } catch { return false; }
}
const payloadSchema = z.object({ groups: z.array(z.object({
  id: z.enum(["jobs", "properties", "people", "invoices"]), label: z.string().min(1).max(100),
  items: z.array(z.object({ id: z.string().min(1).max(200), label: z.string().min(1).max(500),
    description: z.string().max(1000).optional(), href: z.string().max(1000).refine(localDestination),
  })).max(8),
})).max(4) });
type Group = z.infer<typeof payloadSchema>["groups"][number];
type Props = { accent: string; nav: { href: string; label: string }[] };

export function PortalSearch(props: Props) {
  const { data: session, status } = useSession();
  if (status !== "authenticated" || !session?.user?.id) return null;
  const identity = JSON.stringify([session.user.id, session.user.role, session.impersonation,
    props.accent, props.nav.map(item => item.href)]);
  return <SearchSession key={identity} {...props} />;
}

function SearchSession({ accent, nav }: Props) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [retry, setRetry] = React.useState(0);
  const [accessDenied, setAccessDenied] = React.useState(false);
  const opener = React.useRef<HTMLElement | null>(null);
  const [result, setResult] = React.useState<{ query: string; status: "loading" | "ready" | "error" | "denied"; groups: Group[] }>({ query: "", status: "loading", groups: [] });
  const needle = query.trim();
  const status = result.query === needle ? result.status : "loading";
  const groups = status === "ready" ? result.groups : [];
  const destinations = accessDenied ? [] : nav.filter(item => localDestination(item.href) && item.label.toLowerCase().includes(needle.toLowerCase())).slice(0, 8);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k" || event.repeat) return;
      if (!open && document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      setOpen(value => !value);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let disposed = false;
    setResult({ query: needle, status: "loading", groups: [] });
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/portal/search?q=${encodeURIComponent(needle)}`, { cache: "no-store", signal: controller.signal });
        if (disposed) return;
        if (response.status === 401 || response.status === 403) {
          setAccessDenied(true);
          setResult({ query: needle, status: "denied", groups: [] });
          return;
        }
        if (!response.ok) throw new Error("Search unavailable");
        const payload = payloadSchema.parse(await response.json());
        if (!disposed) {
          setAccessDenied(false);
          setResult({ query: needle, status: "ready", groups: payload.groups });
        }
      } catch {
        if (!disposed) setResult({ query: needle, status: "error", groups: [] });
      }
    }, needle ? 250 : 0);
    return () => { disposed = true; window.clearTimeout(timer); controller.abort(); };
  }, [open, needle, retry]);

  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <Dialog.Trigger asChild><button type="button" aria-label="Search portal" title="Search portal"
      className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded hover:bg-black/5 focus-visible:outline focus-visible:outline-2">
      <Search className="h-5 w-5" aria-hidden="true" />
    </button></Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <Dialog.Content data-skin="estate" data-portal-accent={accent} aria-modal="true" aria-describedby={undefined}
        onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
        onCloseAutoFocus={event => { event.preventDefault(); if (opener.current?.isConnected) opener.current.focus(); }}
        className="fixed left-1/2 top-8 z-50 flex max-h-[calc(100dvh-4rem)] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] text-[hsl(var(--e-foreground))] shadow-xl">
        <div className="flex items-center gap-2 border-b border-[hsl(var(--e-border))] p-3">
          <Dialog.Title className="sr-only">Search portal</Dialog.Title>
          <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
          <input type="search" aria-label="Search records and pages" placeholder="Search records and pages" maxLength={100} value={query}
            onChange={event => setQuery(event.target.value)} className="h-11 min-w-0 flex-1 rounded bg-transparent px-2 text-sm focus-visible:outline focus-visible:outline-2" />
          <Dialog.Close aria-label="Close search" title="Close search" className="flex h-11 w-11 shrink-0 items-center justify-center rounded hover:bg-black/5 focus-visible:outline focus-visible:outline-2"><X className="h-5 w-5" aria-hidden="true" /></Dialog.Close>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-3" aria-busy={status === "loading"}>
          {status === "loading" ? <p role="status" className="p-2 text-sm">Searching...</p> : null}
          {status === "error" || status === "denied" ? <div role="alert" className="p-2 text-sm">
            <p>{status === "denied" ? "Search access is unavailable." : "Could not load record results."}</p>
            <button type="button" onClick={() => setRetry(value => value + 1)} className="mt-2 min-h-11 rounded px-3 underline focus-visible:outline focus-visible:outline-2">Retry</button>
          </div> : null}
          {destinations.length ? <section aria-label="Pages"><h2 className="px-2 py-2 text-xs font-semibold">Pages</h2><ul>
            {destinations.map(item => <li key={item.href}><Link prefetch={false} href={item.href} onClick={() => setOpen(false)} className="block rounded px-2 py-3 text-sm hover:bg-black/5 focus-visible:outline focus-visible:outline-2">{item.label}</Link></li>)}
          </ul></section> : null}
          {groups.filter(group => group.items.length).map(group => <section key={group.id} aria-label={group.label}>
            <h2 className="px-2 py-2 text-xs font-semibold">{group.label}</h2><ul>{group.items.map(item => <li key={item.id}>
              <Link prefetch={false} href={item.href} onClick={() => setOpen(false)} className="block rounded px-2 py-3 [overflow-wrap:anywhere] hover:bg-black/5 focus-visible:outline focus-visible:outline-2">
                <p className="text-sm font-medium">{item.label}</p>{item.description ? <p className="mt-1 text-xs text-[hsl(var(--e-muted-foreground))]">{item.description}</p> : null}
              </Link></li>)}</ul>
          </section>)}
          {status === "ready" && !destinations.length && !groups.some(group => group.items.length) ? <p role="status" className="p-2 text-sm">No matching records or pages.</p> : null}
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
