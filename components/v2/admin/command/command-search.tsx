"use client";

/**
 * Header search on Command. Uses the existing portal search API
 * (GET /api/portal/search, the same one behind the shell's search dialog), so
 * results and their access rules are identical. Only same-portal links are
 * followed; late answers for an older query are dropped.
 */
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { z } from "zod";

const resultSchema = z.object({
  groups: z.array(z.object({
    id: z.string(),
    label: z.string(),
    items: z.array(z.object({ id: z.string(), label: z.string(), description: z.string().optional(), href: z.string() })),
  })),
});
type SearchGroup = z.infer<typeof resultSchema>["groups"][number];
type SearchState = { query: string; status: "idle" | "loading" | "ready" | "error"; groups: SearchGroup[] };

function isLocal(href: string): boolean {
  return /^\/v2\/admin(\/|\?|$)/.test(href) && !/[\\\s]/.test(href);
}

export function CommandSearch() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<SearchState>({ query: "", status: "idle", groups: [] });
  const listId = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const needle = query.trim();

  useEffect(() => {
    if (needle.length < 2) {
      setResult({ query: needle, status: "idle", groups: [] });
      return;
    }
    const controller = new AbortController();
    setResult({ query: needle, status: "loading", groups: [] });
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/portal/search?q=${encodeURIComponent(needle)}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("search failed");
        const parsed = resultSchema.parse(await response.json());
        if (controller.signal.aborted) return;
        const groups = parsed.groups.map((group) => ({ ...group, items: group.items.filter((item) => isLocal(item.href)) })).filter((group) => group.items.length > 0);
        setResult({ query: needle, status: "ready", groups });
      } catch {
        if (!controller.signal.aborted) setResult({ query: needle, status: "error", groups: [] });
      }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [needle]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (wrapper.current && !wrapper.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const showPanel = open && needle.length >= 2;
  return (
    <div ref={wrapper} className="relative w-full min-w-0 sm:w-[260px]" onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}>
      <input
        type="search"
        aria-label="Search everything"
        aria-controls={listId}
        placeholder="Search jobs, people, invoices…"
        maxLength={100}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        className="h-[34px] w-full min-w-0 rounded-[var(--e-radius)] border border-[hsl(var(--e-border-strong))] bg-[hsl(var(--e-surface))] px-2.5 text-[0.8125rem] text-[hsl(var(--e-foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]"
      />
      {showPanel ? (
        <div id={listId} className="absolute right-0 z-30 mt-1 max-h-80 w-full min-w-[260px] overflow-y-auto rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-2 shadow-[var(--e-elevation-2)]">
          {result.query !== needle || result.status === "loading" ? <p role="status" className="p-2 text-[0.8125rem]">Searching…</p> : null}
          {result.query === needle && result.status === "error" ? <p role="alert" className="p-2 text-[0.8125rem]">Search is unavailable right now.</p> : null}
          {result.query === needle && result.status === "ready" && result.groups.length === 0 ? <p role="status" className="p-2 text-[0.8125rem]">No matching records.</p> : null}
          {result.query === needle ? result.groups.map((group) => (
            <section key={group.id} aria-label={group.label}>
              <h3 className="px-2 pb-1 pt-2 text-[0.6875rem] font-[600] uppercase tracking-[0.08em] text-[hsl(var(--e-muted-foreground))]">{group.label}</h3>
              <ul>
                {group.items.map((item) => (
                  <li key={item.id}>
                    <Link href={item.href} onClick={() => setOpen(false)} className="block rounded px-2 py-2 text-inherit hover:bg-[hsl(var(--e-muted))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]">
                      <span className="block text-[0.8125rem] font-[550] [overflow-wrap:anywhere]">{item.label}</span>
                      {item.description ? <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))] [overflow-wrap:anywhere]">{item.description}</span> : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )) : null}
        </div>
      ) : null}
    </div>
  );
}
