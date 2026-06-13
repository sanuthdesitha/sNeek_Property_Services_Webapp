import Link from "next/link";
import { Cake } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { UpcomingBirthday } from "@/lib/accounts/overview";

function whenLabel(days: number) {
  if (days === 0) return "Today 🎉";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}

/**
 * Upcoming staff birthdays (next 30 days), computed from User.dateOfBirth.
 * Real data only — staff without a DOB on file simply don't appear.
 */
export function BirthdaysCard({ birthdays }: { birthdays: UpcomingBirthday[] }) {
  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Cake className="h-4 w-4 text-primary" />
          Upcoming birthdays
        </CardTitle>
      </CardHeader>
      <CardContent>
        {birthdays.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No staff birthdays in the next 30 days.
          </div>
        ) : (
          <ul className="space-y-2">
            {birthdays.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/admin/accounts/users/${b.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2 transition-colors hover:border-primary/40"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{b.name ?? "Unnamed"}</p>
                    <p className="text-xs text-muted-foreground">
                      {b.nextBirthday.toLocaleDateString("en-AU", { day: "numeric", month: "long" })}
                      {b.turningAge != null ? ` · turning ${b.turningAge}` : ""}
                    </p>
                  </div>
                  <Badge variant={b.daysUntil === 0 ? "success" : "outline"} className="shrink-0">
                    {whenLabel(b.daysUntil)}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
