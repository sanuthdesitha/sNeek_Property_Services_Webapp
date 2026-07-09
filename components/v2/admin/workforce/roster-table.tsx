"use client";

import * as React from "react";
import Link from "next/link";
import { Briefcase, FileWarning, Search, Star } from "lucide-react";
import { EBadge, ECard, ECardBody, EEmptyState } from "@/components/v2/ui/primitives";
import { EAvatar, EInput, ESelect, ETableShell } from "@/components/v2/admin/estate-kit";
import { lastSeenLabel, prettify } from "@/components/v2/admin/workforce/utils";

export type RosterRow = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: string;
  department: string | null;
  location: string | null;
  qaAverage: number | null;
  qaReviewCount: number;
  verifiedDocumentCount: number;
  pendingDocumentCount: number;
  recognitionCount: number;
  activeJobs: number;
  lastSeenAt: string | null;
};

function qaTone(qa: number | null): "success" | "warning" | "danger" | "neutral" {
  if (qa === null) return "neutral";
  if (qa >= 85) return "success";
  if (qa >= 70) return "warning";
  return "danger";
}

export function RosterTable({ rows }: { rows: RosterRow[] }) {
  const [query, setQuery] = React.useState("");
  const [role, setRole] = React.useState("ALL");

  const roles = React.useMemo(
    () => Array.from(new Set(rows.map((r) => r.role))).sort(),
    [rows],
  );

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (role !== "ALL" && r.role !== role) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        (r.location ?? "").toLowerCase().includes(q) ||
        (r.department ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, query, role]);

  return (
    <ECard>
      <ECardBody className="space-y-4 p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--e-text-faint))]" />
            <EInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, email, location…"
              className="pl-9"
            />
          </div>
          <ESelect value={role} onChange={(e) => setRole(e.target.value)} className="sm:w-52">
            <option value="ALL">All roles</option>
            {roles.map((r) => (
              <option key={r} value={r}>
                {prettify(r)}
              </option>
            ))}
          </ESelect>
        </div>

        {filtered.length === 0 ? (
          <EEmptyState title="No team members" description="No one matches the current search and filters." />
        ) : (
          <ETableShell
            headers={[
              { label: "Member" },
              { label: "Status" },
              { label: "QA", align: "center" },
              { label: "Docs", align: "center" },
              { label: "Kudos", align: "center" },
              { label: "Active", align: "center" },
              { label: "", align: "right" },
            ]}
          >
            {filtered.map((r) => {
              const seen = lastSeenLabel(r.lastSeenAt);
              return (
                <tr key={r.id} className="align-middle">
                  <td className="px-4 py-3">
                    <Link href={`/v2/admin/workforce/performance/${r.id}`} className="flex items-center gap-3 hover:opacity-80">
                      <EAvatar name={r.name} image={r.image} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate text-[0.875rem] font-medium">{r.name}</p>
                        <p className="truncate text-[0.6875rem] text-[hsl(var(--e-muted-foreground))]">
                          {[prettify(r.role), r.location].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: seen.online ? "hsl(var(--e-success))" : "hsl(var(--e-text-faint))" }}
                      />
                      {seen.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {r.qaAverage === null ? (
                      <span className="text-[hsl(var(--e-text-faint))]">—</span>
                    ) : (
                      <EBadge tone={qaTone(r.qaAverage)} soft>
                        <Star className="h-3 w-3" />
                        {r.qaAverage}
                      </EBadge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {r.pendingDocumentCount > 0 ? (
                      <span className="inline-flex items-center gap-1 text-[0.8125rem] text-[hsl(var(--e-warning))]">
                        <FileWarning className="h-3.5 w-3.5" />
                        {r.pendingDocumentCount}
                      </span>
                    ) : (
                      <span className="e-tnum text-[0.8125rem]">{r.verifiedDocumentCount}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center e-tnum text-[0.8125rem]">{r.recognitionCount}</td>
                  <td className="px-4 py-3 text-center">
                    {r.activeJobs > 0 ? (
                      <span className="inline-flex items-center gap-1 text-[0.8125rem]">
                        <Briefcase className="h-3.5 w-3.5 text-[hsl(var(--e-accent-portal))]" />
                        {r.activeJobs}
                      </span>
                    ) : (
                      <span className="text-[hsl(var(--e-text-faint))]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/v2/admin/accounts/users/${r.id}`}
                      className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))] underline underline-offset-4 hover:text-[hsl(var(--e-gold-ink))]"
                    >
                      Account
                    </Link>
                  </td>
                </tr>
              );
            })}
          </ETableShell>
        )}
      </ECardBody>
    </ECard>
  );
}
