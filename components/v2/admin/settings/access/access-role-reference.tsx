"use client";

/**
 * "What each role can do by default": a collapsed, read-only reference on
 * Access and permissions. It restores the old Roles settings reference (role
 * summaries and the base permission matrix) with the content generated from
 * lib/rbac/role-reference (the base role map and the operations-manager area
 * defaults). The body is only built once the disclosure is first opened.
 */
import { useState } from "react";
import { Check } from "lucide-react";
import { ETableShell } from "@/components/v2/admin/estate-kit";
import { ADMIN_ONLY_ACTIONS, REFERENCE_ROLES, referenceRoleLabel, referenceRows, roleSummaries, type ReferenceCell } from "@/lib/rbac/role-reference";

function CellMark({ cell }: { cell: ReferenceCell }) {
  switch (cell.kind) {
    case "granted":
      return (
        <span className="inline-flex h-5 w-5 items-center justify-center text-[hsl(var(--e-success))]" title="Granted">
          <Check aria-hidden className="h-3.5 w-3.5" />
          <span className="sr-only">Granted</span>
        </span>
      );
    case "not-granted":
      return (
        <span title="Not granted">
          <span aria-hidden className="inline-block h-1 w-3 rounded-full bg-[hsl(var(--e-border-strong))]" />
          <span className="sr-only">Not granted</span>
        </span>
      );
    case "area-default":
      return <span className="text-[0.75rem]">{cell.level} by default<span className="sr-only"> ({cell.area})</span></span>;
    case "area-off":
      return <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Off by default<span className="sr-only"> ({cell.area})</span></span>;
    case "needs-full":
      return <span className="text-[0.75rem]" title={`${cell.capability}: needs ${cell.area} at Full and their own PIN`}>Needs Full + PIN</span>;
    case "admin-only":
      return <span className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">Admin only</span>;
  }
}

function ReferenceBody() {
  const summaries = roleSummaries();
  const rows = referenceRows();
  return (
    <div className="mt-3 space-y-5">
      <section aria-labelledby="role-reference-roles">
        <h3 id="role-reference-roles" className="text-[0.875rem] font-[600]">Portal roles</h3>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {REFERENCE_ROLES.map((role) => (
            <li key={role} className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
              <p className="text-[0.8125rem] font-[600]">{referenceRoleLabel(role)}</p>
              <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">{summaries[role]}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="role-reference-matrix" className="space-y-2">
        <h3 id="role-reference-matrix" className="text-[0.875rem] font-[600]">Base role permissions</h3>
        <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
          The base role map kept in code. An operations manager is further limited by the areas set on this screen; the column shows what an
          operations manager with no preset has. Record ownership and service-specific checks still apply to everyone.
        </p>
        <ETableShell
          headers={[
            { label: "Permission" },
            ...REFERENCE_ROLES.map((role) => ({ label: referenceRoleLabel(role), align: "center" as const })),
          ]}
        >
          {rows.map((row) => (
            <tr key={row.permission} className="border-b border-[hsl(var(--e-border))] last:border-0">
              <th scope="row" className="px-4 py-2 text-left font-normal">
                <code className="text-[0.75rem]">{row.permission}</code>
              </th>
              {REFERENCE_ROLES.map((role) => (
                <td key={role} className="px-4 py-2 text-center">
                  <CellMark cell={row.cells[role]} />
                </td>
              ))}
            </tr>
          ))}
        </ETableShell>
      </section>

      <section aria-labelledby="role-reference-admin-only">
        <h3 id="role-reference-admin-only" className="text-[0.875rem] font-[600]">Only administrators</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[0.8125rem]">
          {ADMIN_ONLY_ACTIONS.map((action) => (
            <li key={action.label}>
              {action.label}
              <span className="text-[hsl(var(--e-muted-foreground))]"> — {action.reason}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function AccessRoleReference() {
  const [opened, setOpened] = useState(false);
  return (
    <details
      className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-4 py-2"
      onToggle={(event) => {
        if ((event.currentTarget as HTMLDetailsElement).open) setOpened(true);
      }}
    >
      <summary className="min-h-10 cursor-pointer py-2 text-[0.875rem] font-[550]">What each role can do by default</summary>
      {opened ? <ReferenceBody /> : null}
    </details>
  );
}
