import Link from "next/link";
import { Cake } from "lucide-react";
import { EBadge, ECard, ECardBody, ECardHeader, ECardTitle } from "@/components/v2/ui/primitives";

export interface EstateBirthdayRow {
  id: string;
  name: string | null;
  /** ISO date of this year's occurrence. */
  nextBirthday: string;
  daysUntil: number;
  turningAge: number | null;
}

function whenLabel(days: number) {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}

/**
 * Upcoming staff birthdays (next 30 days), computed from User.dateOfBirth by
 * lib/accounts/overview.ts. Estate-native rendering of the same data.
 */
export function EstateBirthdaysCard({ birthdays }: { birthdays: EstateBirthdayRow[] }) {
  return (
    <ECard>
      <ECardHeader className="pb-3">
        <ECardTitle className="flex items-center gap-2 text-[1rem]">
          <Cake className="h-4 w-4 text-[hsl(var(--e-gold-ink))]" />
          Upcoming birthdays
        </ECardTitle>
      </ECardHeader>
      <ECardBody>
        {birthdays.length === 0 ? (
          <div className="rounded-[var(--e-radius)] border border-dashed border-[hsl(var(--e-border-strong))] p-6 text-center text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            No staff birthdays in the next 30 days.
          </div>
        ) : (
          <ul className="space-y-2">
            {birthdays.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/v2/admin/accounts/users/${b.id}`}
                  className="flex items-center justify-between gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 py-2 transition-colors duration-[160ms] hover:border-[hsl(var(--e-border-gold)/0.5)]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[0.875rem] font-[550]">{b.name ?? "Unnamed"}</p>
                    <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                      {new Date(b.nextBirthday).toLocaleDateString("en-AU", { day: "numeric", month: "long" })}
                      {b.turningAge != null ? ` · turning ${b.turningAge}` : ""}
                    </p>
                  </div>
                  <EBadge tone={b.daysUntil === 0 ? "gold" : "neutral"} soft={b.daysUntil === 0}>
                    {whenLabel(b.daysUntil)}
                  </EBadge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </ECardBody>
    </ECard>
  );
}
