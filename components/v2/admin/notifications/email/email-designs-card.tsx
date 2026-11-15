"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { allDesignsForType as designsForType } from "@/lib/email-design/all-designs";
import type { DesignListItem } from "@/lib/email-design/view-types";

type Props = {
  typeKey: string;
  items: Map<string, DesignListItem>;
  listError: string | null;
  onOpen: (designKey: string) => void;
};

function stateText(item: DesignListItem | undefined, security: boolean): string {
  if (!item) return "State not loaded";
  if (item.readFailed) return "State could not be read";
  const parts: string[] = [];
  parts.push(item.publishedVersion ? `Published v${item.publishedVersion}` : "Standard v1");
  if (item.hasDraft) parts.push("draft waiting");
  if (item.customHtml) parts.push("custom HTML from before is in use");
  if (security) parts.push("core content fixed");
  return parts.join(" · ");
}

/**
 * The Email tab of a type: the block-layout emails this type sends, each
 * opening the email editor. Shown under the type's details in Types and
 * wording.
 */
export function EmailDesignsCard({ typeKey, items, listError, onOpen }: Props) {
  const designs = designsForType(typeKey);
  if (designs.length === 0) return null;
  return (
    <section aria-labelledby={`email-designs-${typeKey}`} className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-2">
      <div className="flex items-baseline justify-between gap-2 px-2 pt-1.5">
        <h3 id={`email-designs-${typeKey}`} className="text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--e-muted-foreground))]">Email design</h3>
        <Link href="/v2/admin/notifications/email-look" className="text-xs underline underline-offset-2">Email look</Link>
      </div>
      {listError ? <p className="px-2 pt-1 text-xs">{listError}</p> : null}
      <ul className="divide-y divide-[hsl(var(--e-border))]">
        {designs.map((design) => (
          <li key={design.key}>
            <button
              type="button"
              onClick={() => onOpen(design.key)}
              className="flex min-h-14 w-full items-center justify-between gap-2 px-2 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--e-ring))]"
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold">Email: {design.label}</span>
                <span className="block text-xs text-[hsl(var(--e-muted-foreground))]">{stateText(items.get(design.key), design.security)}</span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 text-sm">{design.security ? "View" : "Edit"}<ChevronRight aria-hidden className="h-4 w-4" /></span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
