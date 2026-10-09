"use client";

import { OpsPermissionsSection } from "./ops-permissions-section";
import * as React from "react";
import { Role } from "@prisma/client";
import { ShieldCheck, Check } from "lucide-react";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  ECard,
  ECardHeader,
  ECardTitle,
  ECardBody,
  EEyebrow,
} from "@/components/v2/ui/primitives";
import { ETableShell } from "@/components/v2/admin/estate-kit";

const ROLE_SUMMARY: Record<Role, string> = {
  [Role.ADMIN]: "Full platform access including settings and pricing",
  [Role.OPS_MANAGER]: "Jobs, QA, reports, clients, properties, and quotes",
  [Role.QA_INSPECTOR]:
    "Claimable QA queue, inspections, and feedback to cleaners",
  [Role.CLEANER]: "Assigned jobs, form submission, uploads, and time logs",
  [Role.CLIENT]: "Own properties and reports only",
  [Role.LAUNDRY]: "Laundry week schedule and ready queue",
  [Role.MAINTENANCE]:
    "Assigned repair jobs, access details, and on-site visit tracking",
  [Role.VA]: "Acts for a client, limited to what that client's VA team allows",
};

// Column order for the matrix — every role that appears anywhere in the map.
const ROLE_COLUMNS = Object.keys(ROLE_SUMMARY) as Role[];

const PERMISSION_ROWS = (
  Object.keys(PERMISSIONS) as Array<keyof typeof PERMISSIONS>
).map((permission) => ({
  permission,
  roles: new Set(PERMISSIONS[permission] as readonly Role[]),
}));

export function RolesSection(_: { isAdmin?: boolean } = {}) {
  return (
    <div className="space-y-4">
      <OpsPermissionsSection />
      <details className="rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] p-4">
        <summary className="cursor-pointer py-3 text-sm font-medium">
          Base roles and permissions reference
        </summary>
        <div className="mt-4 space-y-4">
          <ECard>
            <ECardHeader className="flex-row items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[hsl(var(--e-border-strong))] text-[hsl(var(--e-accent-portal))] [&>svg]:h-4 [&>svg]:w-4">
                <ShieldCheck />
              </span>
              <div>
                <EEyebrow>Access</EEyebrow>
                <ECardTitle className="text-[1.05rem]">Portal roles</ECardTitle>
              </div>
            </ECardHeader>
            <ECardBody className="grid gap-3 sm:grid-cols-2">
              {ROLE_COLUMNS.map((role) => (
                <div
                  key={role}
                  className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-3"
                >
                  <p className="text-[0.8125rem] font-[600] tracking-[0.02em] text-[hsl(var(--e-foreground))]">
                    {role}
                  </p>
                  <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    {ROLE_SUMMARY[role]}
                  </p>
                </div>
              ))}
            </ECardBody>
          </ECard>

          <ECard>
            <ECardHeader>
              <ECardTitle className="text-[1.05rem]">
                Base role reference
              </ECardTitle>
              <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                Base role definitions are maintained in code. Operations-manager
                settings above restrict this access; record ownership and
                service-specific checks still apply.
              </p>
            </ECardHeader>
            <ECardBody className="pt-0">
              <ETableShell
                headers={[
                  { label: "Permission" },
                  ...ROLE_COLUMNS.map((role) => ({
                    label: role.replace(/_/g, " "),
                    align: "center" as const,
                  })),
                ]}
              >
                {PERMISSION_ROWS.map((row) => (
                  <tr
                    key={row.permission}
                    className="hover:bg-[hsl(var(--e-muted)/0.4)]"
                  >
                    <td className="px-4 py-2.5">
                      <code className="text-[0.75rem] text-[hsl(var(--e-foreground))]">
                        {row.permission}
                      </code>
                    </td>
                    {ROLE_COLUMNS.map((role) => (
                      <td key={role} className="px-4 py-2.5 text-center">
                        {row.roles.has(role) ? (
                          <span
                            className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[hsl(var(--e-success))]"
                            aria-label="Granted"
                            title="Granted"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </span>
                        ) : (
                          <span
                            className="inline-block h-1 w-3 rounded-full bg-[hsl(var(--e-border-strong))]"
                            aria-label="Not granted"
                            title="Not granted"
                          />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </ETableShell>
            </ECardBody>
          </ECard>
        </div>
      </details>
    </div>
  );
}

export default RolesSection;
