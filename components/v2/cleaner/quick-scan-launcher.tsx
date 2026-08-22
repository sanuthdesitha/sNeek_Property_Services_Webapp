"use client";

/**
 * Which cupboard are you standing in front of?
 *
 * Quick scan needs a property before the camera is worth opening, because a
 * scan resolves stock AT a place. Asking here — rather than opening the camera
 * and then discovering nothing can be applied — gets the one question answered
 * while the phone is still in a pocket.
 *
 * (A label pinned to a property overrides this anyway: the printed tag is
 * physically attached to a shelf and is better evidence than a dropdown. The
 * picker matters for general labels and for manufacturer barcodes, which carry
 * no location at all.)
 */

import * as React from "react";
import Link from "next/link";
import { ChevronRight, ScanLine } from "lucide-react";
import { ECard, ECardBody, EEmptyState } from "@/components/v2/ui/primitives";

export function QuickScanLauncher({
  properties,
}: {
  properties: Array<{ id: string; name: string; suburb?: string | null }>;
}) {
  const [search, setSearch] = React.useState("");

  const visible = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return properties;
    return properties.filter((p) =>
      [p.name, p.suburb].filter(Boolean).join(" ").toLowerCase().includes(needle)
    );
  }, [properties, search]);

  if (properties.length === 0) {
    return (
      <EEmptyState
        title="No properties assigned"
        description="Quick scan needs a property to adjust stock against."
      />
    );
  }

  return (
    <div className="space-y-3">
      {/* Only worth the space once the list is long enough to scroll. */}
      {properties.length > 6 ? (
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Find a property…"
          className="w-full rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 py-2 text-[0.875rem]"
        />
      ) : null}

      <ECard>
        <ECardBody className="p-0">
          <ul className="divide-y divide-[hsl(var(--e-border))]">
            {visible.map((property) => (
              <li key={property.id}>
                <Link
                  href={`/v2/cleaner/quick-scan/${property.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-[hsl(var(--e-surface-raised))]"
                >
                  <ScanLine className="h-4 w-4 shrink-0 text-[hsl(var(--e-primary))]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.875rem] font-[550]">
                      {property.name}
                    </span>
                    {property.suburb ? (
                      <span className="block truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                        {property.suburb}
                      </span>
                    ) : null}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[hsl(var(--e-text-faint))]" />
                </Link>
              </li>
            ))}
          </ul>
        </ECardBody>
      </ECard>
    </div>
  );
}
