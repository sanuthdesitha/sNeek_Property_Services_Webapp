"use client";

/**
 * The four counters above the work queue; each opens its page already
 * filtered. On a phone they fold behind one "4 figures · Show" row so the work
 * queue is on the first screen (board "Admin phone"); unchanged from 640px up.
 */
import Link from "next/link";
import { CollapsibleFigures } from "@/components/v2/ui/collapsible-figures";
import { EPill } from "@/components/v2/ui/pill";
import type { CommandTilesPayload } from "@/lib/dashboard/command-types";
import { SectionBody } from "./section-state";
import { useCommandSection } from "./use-command-section";

export function CommandTiles({ initial, timeZone }: { initial: CommandTilesPayload | null; timeZone: string }) {
  const state = useCommandSection<CommandTilesPayload>("tiles", initial);
  return (
    <section aria-label="Counters" className="min-w-0">
      <SectionBody state={state} label="Counters" timeZone={timeZone} rows={1}>
        {(data) => data.tiles.length === 0 ? null : (
          <CollapsibleFigures storageKey="command:counters" count={data.tiles.length} label="Command counters">
          <div className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4">
            {data.tiles.map((tile) => (
              <Link
                key={tile.key}
                href={tile.href}
                className="min-w-0 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 py-3.5 text-inherit no-underline transition-colors hover:border-[hsl(var(--e-border-strong))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]"
              >
                <span className="e-eyebrow block [overflow-wrap:anywhere]">{tile.label}</span>
                <span className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="e-numeral text-[1.75rem] leading-none">{tile.count ?? "—"}</span>
                  <EPill tone={tile.badge.tone}>{tile.badge.text}</EPill>
                </span>
              </Link>
            ))}
          </div>
          </CollapsibleFigures>
        )}
      </SectionBody>
    </section>
  );
}
