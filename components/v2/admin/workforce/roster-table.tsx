"use client";

/**
 * Workforce › Roster (board "Workforce" tab 2; phone cards on M-Workforce):
 * who is active, how busy and how they are doing. "No reviews yet" and "Not
 * recorded" are written out, never shown as 0 or blank. A row's name opens
 * the cleaner's full page; Performance opens the performance page.
 */
import * as React from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { useRestorableState } from "@/hooks/use-restorable-state";
import { EAvatar, EInput } from "@/components/v2/admin/estate-kit";
import { EFilterChips } from "@/components/v2/ui/filter-chips";
import { cn } from "@/lib/utils";
import { prettify } from "@/components/v2/admin/workforce/utils";

export type RosterRow = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: string;
  extraRoles: string[];
  location: string | null;
  startedAt: string;
  qaAverage: number | null;
  qaReviewCount: number;
  verifiedDocumentCount: number;
  pendingDocumentCount: number;
  expiringDocumentCount: number;
  expiredDocumentCount: number;
  recognitionCount: number;
  activeJobs: number;
  inProgressJobs: number;
  lastSeenAt: string | null;
};

type RoleChip = "CLEANER" | "LAUNDRY" | "ALL";

function lastSeenWords(iso: string | null, timeZone: string): string {
  if (!iso) return "Not recorded";
  const date = new Date(iso);
  const dayKey = (value: Date) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(value);
  const time = new Intl.DateTimeFormat("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(date);
  if (dayKey(date) === dayKey(new Date())) return `Today ${time}`;
  return new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone }).format(date);
}

function jobsWords(row: RosterRow): string {
  if (row.activeJobs === 0) return "0";
  if (row.inProgressJobs > 0) return `${row.activeJobs} · ${row.inProgressJobs} in progress`;
  return `${row.activeJobs} · assigned`;
}

function qaWords(row: RosterRow): string {
  if (row.qaAverage === null || row.qaReviewCount === 0) return "No reviews yet";
  return `${Math.round(row.qaAverage)} from ${row.qaReviewCount} review${row.qaReviewCount === 1 ? "" : "s"}`;
}

function DocumentsCell({ row }: { row: RosterRow }) {
  const parts: React.ReactNode[] = [];
  if (row.expiredDocumentCount > 0) parts.push(<span key="expired" className="font-[600] text-[hsl(var(--e-danger))]">▲ {row.expiredDocumentCount} expired</span>);
  parts.push(<span key="verified">{row.verifiedDocumentCount} verified</span>);
  if (row.expiringDocumentCount > 0) parts.push(<span key="expiring">{row.expiringDocumentCount} expiring</span>);
  if (row.pendingDocumentCount > 0) parts.push(<span key="waiting">{row.pendingDocumentCount} waiting</span>);
  return (
    <span className="inline-flex flex-wrap gap-x-1">
      {parts.map((part, index) => (
        <React.Fragment key={index}>
          {index > 0 ? <span aria-hidden>·</span> : null}
          {part}
        </React.Fragment>
      ))}
    </span>
  );
}

function roleLine(row: RosterRow, timeZone: string): string {
  const roles = [row.role, ...row.extraRoles].map((role) => (role === "QA_INSPECTOR" ? "QA inspector" : prettify(role.toLowerCase())));
  const started = Date.now() - Date.parse(row.startedAt) < 45 * 86_400_000
    ? ` · started ${new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", timeZone }).format(new Date(row.startedAt))}`
    : "";
  return `${roles.join(" + ")}${started}`;
}

export function RosterTable({ rows, timeZone }: { rows: RosterRow[]; timeZone: string }) {
  const [query, setQuery] = useRestorableState("roster-table:query", "");
  const [roleChip, setRoleChip] = React.useState<RoleChip>("CLEANER");
  const [docsWaiting, setDocsWaiting] = React.useState(false);

  const counts = React.useMemo(() => ({
    CLEANER: rows.filter((row) => row.role === "CLEANER").length,
    LAUNDRY: rows.filter((row) => row.role === "LAUNDRY").length,
    ALL: rows.length,
  }), [rows]);

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (roleChip !== "ALL" && row.role !== roleChip) return false;
      if (docsWaiting && row.pendingDocumentCount === 0) return false;
      if (!needle) return true;
      return [row.name, row.email, row.location ?? ""].join(" ").toLowerCase().includes(needle);
    });
  }, [rows, query, roleChip, docsWaiting]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--e-text-faint))]" />
          <EInput aria-label="Search name, email, base" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email, base" className="pl-9" />
        </div>
        <EFilterChips<RoleChip>
          label="Team"
          phoneLayout="carousel"
          active={roleChip}
          onChange={setRoleChip}
          chips={[
            { key: "CLEANER", label: "Cleaners", count: counts.CLEANER },
            { key: "LAUNDRY", label: "Laundry", count: counts.LAUNDRY },
            { key: "ALL", label: "Everyone", count: counts.ALL },
          ]}
        />
        <button
          type="button"
          aria-pressed={docsWaiting}
          onClick={() => setDocsWaiting((value) => !value)}
          className={cn(
            "inline-flex min-h-9 items-center rounded-full border px-3 text-[0.8125rem] max-sm:min-h-11",
            docsWaiting ? "border-[hsl(var(--e-primary)/0.35)] bg-[hsl(var(--e-primary-soft))] font-[600] text-[hsl(var(--e-primary))]" : "border-[hsl(var(--e-border-strong))]",
          )}
        >
          Documents waiting
        </button>
        <span className="ml-auto text-[0.75rem] text-[hsl(var(--e-muted-foreground))] max-sm:hidden">Last seen in Sydney time</span>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4 text-[0.875rem]">
          {rows.length === 0 ? "No active team members." : "No one matches the search and filters."}
        </p>
      ) : (
        <>
          <div role="region" aria-label="Roster" tabIndex={0} className="overflow-x-auto rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] max-sm:hidden">
            <table className="w-full min-w-[880px] text-left text-[0.8125rem]">
              <thead>
                <tr className="border-b border-[hsl(var(--e-border))] text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  {["Person", "Base", "Jobs now", "QA average", "Documents", "Kudos", "Last seen"].map((label) => (
                    <th key={label} scope="col" className="px-3 py-2 font-[550]">{label}</th>
                  ))}
                  <th scope="col" className="px-3 py-2"><span className="sr-only">Performance</span></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id} className="border-b border-[hsl(var(--e-border))] last:border-0">
                    <td className="px-3 py-2.5">
                      <Link href={`/v2/admin/accounts/users/${row.id}`} className="flex items-center gap-2.5 hover:underline">
                        <EAvatar name={row.name} image={row.image} size="sm" />
                        <span className="min-w-0">
                          <span className="block font-[600]">{row.name}</span>
                          <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{roleLine(row, timeZone)}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">{row.location ?? "Not recorded"}</td>
                    <td className="px-3 py-2.5">{jobsWords(row)}</td>
                    <td className="px-3 py-2.5">{qaWords(row)}</td>
                    <td className="px-3 py-2.5"><DocumentsCell row={row} /></td>
                    <td className="px-3 py-2.5 e-tnum">{row.recognitionCount}</td>
                    <td className="px-3 py-2.5">{lastSeenWords(row.lastSeenAt, timeZone)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <Link href={`/v2/admin/workforce/performance/${row.id}`} className="font-[550] text-[hsl(var(--e-primary))] underline underline-offset-2">Performance</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-2.5 sm:hidden">
            {filtered.map((row) => (
              <li key={row.id} className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-3.5">
                <Link href={`/v2/admin/accounts/users/${row.id}`} className="flex items-center gap-2.5">
                  <EAvatar name={row.name} image={row.image} size="sm" />
                  <span className="min-w-0">
                    <span className="block text-[0.9375rem] font-[600]">{row.name}</span>
                    <span className="block text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{roleLine(row, timeZone)}{row.location ? ` · ${row.location}` : ""}</span>
                  </span>
                </Link>
                <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[0.8125rem]">
                  <dt className="text-[hsl(var(--e-muted-foreground))]">Jobs now</dt><dd>{jobsWords(row)}</dd>
                  <dt className="text-[hsl(var(--e-muted-foreground))]">QA average</dt><dd>{qaWords(row)}</dd>
                  <dt className="text-[hsl(var(--e-muted-foreground))]">Documents</dt><dd><DocumentsCell row={row} /></dd>
                  <dt className="text-[hsl(var(--e-muted-foreground))]">Last seen</dt><dd>{lastSeenWords(row.lastSeenAt, timeZone)}</dd>
                </dl>
                <Link href={`/v2/admin/workforce/performance/${row.id}`} className="mt-2 inline-flex min-h-11 items-center font-[550] text-[hsl(var(--e-primary))] underline underline-offset-2">Performance</Link>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">The name opens the person&rsquo;s full page. &ldquo;No reviews yet&rdquo; and &ldquo;Not recorded&rdquo; are written out, never shown as 0 or blank.</p>
    </div>
  );
}
