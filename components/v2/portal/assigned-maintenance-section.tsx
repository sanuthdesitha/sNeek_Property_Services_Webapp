/**
 * CP-6 — "my maintenance" for a cleaner or a QA inspector.
 *
 * Server component. It renders ONLY what the assignment table says this person
 * is on: being assigned is the permission, so there is no property or job check
 * layered on top. When the roster is empty the caller should not have routed
 * here at all (the nav entry is hidden), so the empty state is a fallback for
 * the person who bookmarked the URL or was just taken off their last item.
 */
import { MaintenanceAssigneeRole, MaintenancePriority, MaintenanceStatus } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { CalendarClock, MapPin, Wrench } from "lucide-react";
import {
  EBadge,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
  EEyebrow,
  EThread,
} from "@/components/v2/ui/primitives";
import {
  MAINTENANCE_ASSIGNEE_ROLE_LABELS,
} from "@/lib/maintenance/assignment-roles";
import { listMaintenanceItemsForUser } from "@/lib/maintenance/assignments";
import { PRIORITY_LABELS, STATUS_LABELS } from "@/lib/maintenance/labels";
import { parseInstructions } from "@/lib/maintenance/instructions";
import {
  MaintenanceAssignmentActions,
  type AssignmentActionState,
} from "@/components/v2/portal/maintenance-assignment-actions";

const TZ = "Australia/Sydney";

type Tone = "neutral" | "primary" | "info" | "success" | "warning" | "danger";

function priorityTone(priority: MaintenancePriority): Tone {
  switch (priority) {
    case MaintenancePriority.URGENT:
      return "danger";
    case MaintenancePriority.HIGH:
      return "warning";
    case MaintenancePriority.MEDIUM:
      return "info";
    default:
      return "neutral";
  }
}

function statusTone(status: MaintenanceStatus): Tone {
  switch (status) {
    case MaintenanceStatus.RESOLVED:
      return "success";
    case MaintenanceStatus.IN_PROGRESS:
      return "info";
    case MaintenanceStatus.ORDERED:
      return "warning";
    case MaintenanceStatus.ACKNOWLEDGED:
      return "primary";
    default:
      return "neutral";
  }
}

function fmt(value: Date | null | undefined): string | null {
  if (!value) return null;
  return formatInTimeZone(value, TZ, "d MMM yyyy, h:mm a");
}

export interface AssignedMaintenanceSectionProps {
  userId: string;
  /** Portal-specific wording under the heading. */
  eyebrow: string;
  /** What this person is expected to do, shown above the list. */
  intro: string;
}

export async function AssignedMaintenanceSection({
  userId,
  eyebrow,
  intro,
}: AssignedMaintenanceSectionProps) {
  const [active, history] = await Promise.all([
    listMaintenanceItemsForUser(userId, { scope: "active" }),
    listMaintenanceItemsForUser(userId, { scope: "history", take: 20 }),
  ]);

  return (
    <div className="space-y-8">
      <header className="e-rise">
        <EEyebrow>{eyebrow}</EEyebrow>
        <h1 className="e-display-lg mt-2">Maintenance assigned to you.</h1>
        <div className="e-signature-rule mt-4" />
        <p className="mt-4 max-w-2xl text-[0.875rem] text-[hsl(var(--e-muted-foreground))]">{intro}</p>
      </header>

      <ECard>
        <ECardHeader>
          <ECardTitle className="flex items-center gap-2 text-[1rem]">
            <Wrench className="h-4 w-4" /> Open items
          </ECardTitle>
        </ECardHeader>
        <ECardBody className="space-y-1">
          {active.length === 0 ? (
            <EEmptyState
              eyebrow="Nothing assigned"
              title="No maintenance for you right now"
              description="This section only lists items you have personally been put on. When an admin assigns you, it will appear here and you will get an email."
            />
          ) : (
            active.map((entry, index) => (
              <div key={entry.item.id}>
                {index > 0 ? <EThread className="my-1" /> : null}
                <MaintenanceRow entry={entry} />
              </div>
            ))
          )}
        </ECardBody>
      </ECard>

      {history.length > 0 ? (
        <ECard>
          <ECardHeader>
            <ECardTitle className="text-[1rem]">Recently closed</ECardTitle>
          </ECardHeader>
          <ECardBody className="space-y-1">
            {history.map((entry, index) => (
              <div key={entry.item.id}>
                {index > 0 ? <EThread className="my-1" /> : null}
                <MaintenanceRow entry={entry} readOnly />
              </div>
            ))}
          </ECardBody>
        </ECard>
      ) : null}
    </div>
  );
}

function MaintenanceRow({
  entry,
  readOnly,
}: {
  entry: {
    item: {
      id: string;
      title: string;
      description: string | null;
      area: string | null;
      priority: MaintenancePriority;
      status: MaintenanceStatus;
      scheduledFor: Date | null;
      property: { id: string; name: string | null; suburb: string | null; address: string | null } | null;
    };
    roles: MaintenanceAssigneeRole[];
    assignment?: AssignmentActionState;
  };
  /** History rows are a record, not a to-do list — no actions on them. */
  readOnly?: boolean;
}) {
  const { item, roles } = entry;
  const instructions = parseInstructions((item as { assignmentInstructions?: unknown }).assignmentInstructions);
  const place = [item.property?.name, item.property?.suburb].filter(Boolean).join(", ");
  const scheduled = fmt(item.scheduledFor);

  return (
    <div className="py-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[0.9375rem] font-medium text-[hsl(var(--e-foreground))]">{item.title}</p>
          {place ? (
            <p className="mt-0.5 flex items-center gap-1.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              <MapPin className="h-3 w-3" /> {place}
              {item.area ? ` · ${item.area}` : ""}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <EBadge tone={priorityTone(item.priority)} soft>
            {PRIORITY_LABELS[item.priority]}
          </EBadge>
          <EBadge tone={statusTone(item.status)} soft>
            {STATUS_LABELS[item.status]}
          </EBadge>
        </div>
      </div>

      {item.description ? (
        <p className="mt-1.5 text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">{item.description}</p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {/* The hat (or hats) this person wears on the item — the same role
            separation the admin sees, from the other side. */}
        {roles.map((role) => (
          <EBadge key={role} tone="primary" soft>
            {MAINTENANCE_ASSIGNEE_ROLE_LABELS[role]}
          </EBadge>
        ))}
        {scheduled ? (
          <span className="flex items-center gap-1.5 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
            <CalendarClock className="h-3 w-3" /> {scheduled}
          </span>
        ) : null}
      </div>

      {/* Everything the office wanted them to know before they set off:
          gate codes, which meter, where the key is, who to ring. */}
      {instructions.length > 0 ? (
        <ul className="mt-2 space-y-1.5 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-2.5">
          {instructions.map((block) => (
            <li key={block.id} className="text-[0.8125rem]">
              <span className="font-[600]">{block.title}</span>
              {block.body ? (
                <span className="text-[hsl(var(--e-text-secondary))]"> — {block.body}</span>
              ) : null}
              {block.address ? (
                <span className="text-[hsl(var(--e-text-secondary))]"> — {block.address}</span>
              ) : null}
              {block.contactName || block.contactPhone ? (
                <span className="text-[hsl(var(--e-text-secondary))]">
                  {" "}— {[block.contactName, block.contactPhone].filter(Boolean).join(" · ")}
                </span>
              ) : null}
              {block.photoKeys?.length ? (
                <span className="text-[hsl(var(--e-muted-foreground))]">
                  {" "}({block.photoKeys.length} photo{block.photoKeys.length === 1 ? "" : "s"})
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {!readOnly && entry.assignment ? (
        <MaintenanceAssignmentActions assignment={entry.assignment} />
      ) : null}
    </div>
  );
}
