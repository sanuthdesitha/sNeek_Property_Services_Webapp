"use client";

/**
 * ESTATE — Settings › Audit log.
 * Native port of v1's SettingsWorkspace "audit" tab + SettingsAuditLog. Self-
 * fetches from GET /api/admin/settings/audit (AppSettings history, newest first,
 * capped at 30 server-side) and renders a native Estate table with a user/action
 * text filter. Restore posts to POST /api/admin/settings/restore (admin only),
 * exactly like v1. Native Estate styling only (--e-* tokens).
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { ScrollText, RotateCcw, Search } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  ECard,
  ECardHeader,
  ECardTitle,
  ECardBody,
  EEyebrow,
  EButton,
  EBadge,
  EEmptyState,
} from "@/components/v2/ui/primitives";
import { EInput, ETableShell } from "@/components/v2/admin/estate-kit";

type AuditEntry = {
  id: string;
  action: string;
  createdAt: string;
  ipAddress: string | null;
  user: { name: string | null; email: string } | null;
  before: unknown;
  after: unknown;
};

function changedKeys(before: unknown, after: unknown): string[] {
  if (!before || typeof before !== "object" || !after || typeof after !== "object") return [];
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)]));
  return keys.filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]));
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AuditSection({ isAdmin = true }: { isAdmin?: boolean } = {}) {
  const router = useRouter();
  const [entries, setEntries] = React.useState<AuditEntry[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [restoringId, setRestoringId] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/settings/audit", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load audit log.");
        return res.json();
      })
      .then((rows: AuditEntry[]) => {
        if (!cancelled) setEntries(Array.isArray(rows) ? rows : []);
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message ?? "Could not load audit log.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = React.useMemo(() => {
    if (!entries) return [];
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => {
      const hay = `${e.action} ${e.user?.name ?? ""} ${e.user?.email ?? ""} ${e.ipAddress ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [entries, query]);

  async function restore(auditId: string) {
    setRestoringId(auditId);
    try {
      const res = await fetch("/api/admin/settings/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not restore the selected settings snapshot.");
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("sneek:settings-restored", { detail: body }));
      }
      toast({ title: "Settings restored" });
      router.refresh();
    } catch (err: any) {
      toast({
        title: "Restore failed",
        description: err?.message ?? "Could not restore the selected settings snapshot.",
        variant: "destructive",
      });
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <ECard>
      <ECardHeader className="flex-row items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-accent-portal))] [&>svg]:h-4 [&>svg]:w-4">
            <ScrollText />
          </span>
          <div>
            <EEyebrow>System</EEyebrow>
            <ECardTitle className="text-[1.05rem]">Settings audit log</ECardTitle>
          </div>
        </div>
        <div className="relative w-full max-w-[16rem]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--e-text-faint))]" />
          <EInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by user or action…"
            className="pl-8"
          />
        </div>
      </ECardHeader>
      <ECardBody className="pt-0">
        {error ? (
          <p className="text-[0.875rem] text-[hsl(var(--e-danger))]">{error}</p>
        ) : entries === null ? (
          <p className="text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">Loading settings history…</p>
        ) : filtered.length === 0 ? (
          <EEmptyState
            eyebrow="Audit"
            title={query ? "No matching entries" : "No changes logged"}
            description={
              query
                ? "No audit entries match this filter."
                : "Settings changes will appear here once they are made."
            }
          />
        ) : (
          <ETableShell
            headers={[
              { label: "When" },
              { label: "Action" },
              { label: "User" },
              { label: "Changed" },
              ...(isAdmin ? [{ label: "", align: "right" as const }] : []),
            ]}
          >
            {filtered.map((entry) => {
              const keys = changedKeys(entry.before, entry.after);
              const who = entry.user?.name?.trim() ? entry.user.name : entry.user?.email ?? "Unknown";
              return (
                <tr key={entry.id} className="align-top hover:bg-[hsl(var(--e-muted)/0.4)]">
                  <td className="whitespace-nowrap px-4 py-3 text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
                    {formatDate(entry.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <EBadge tone="neutral">{entry.action}</EBadge>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-[0.8125rem] font-[550] text-[hsl(var(--e-foreground))]">{who}</p>
                    <p className="text-[0.6875rem] text-[hsl(var(--e-text-faint))]">
                      {entry.user?.email ?? ""}
                      {entry.ipAddress ? ` · ${entry.ipAddress}` : ""}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    {keys.length > 0 ? keys.join(", ") : "Snapshot recorded"}
                  </td>
                  {isAdmin ? (
                    <td className="px-4 py-3 text-right">
                      <EButton
                        variant="outline"
                        size="sm"
                        onClick={() => restore(entry.id)}
                        disabled={restoringId === entry.id}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {restoringId === entry.id ? "Restoring…" : "Restore"}
                      </EButton>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </ETableShell>
        )}
      </ECardBody>
    </ECard>
  );
}

export default AuditSection;
