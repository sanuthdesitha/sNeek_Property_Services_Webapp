"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";

type AuditEntry = {
  id: string;
  action: string;
  createdAt: string;
  ipAddress: string | null;
  user: {
    name: string | null;
    email: string;
  };
  before: unknown;
  after: unknown;
};

function summarizeChangedKeys(before: unknown, after: unknown) {
  if (!before || typeof before !== "object" || !after || typeof after !== "object") {
    return [];
  }

  const beforeRecord = before as Record<string, unknown>;
  const afterRecord = after as Record<string, unknown>;
  const keys = Array.from(new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)]));

  return keys.filter((key) => JSON.stringify(beforeRecord[key]) !== JSON.stringify(afterRecord[key]));
}

export function SettingsAuditLog({ entries }: { entries: AuditEntry[] }) {
  const router = useRouter();
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      entries.map((entry) => ({
        ...entry,
        changedKeys: summarizeChangedKeys(entry.before, entry.after),
      })),
    [entries]
  );

  async function restoreEntry(auditId: string) {
    setRestoringId(auditId);
    const res = await fetch("/api/admin/settings/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auditId }),
    });
    const body = await res.json().catch(() => ({}));
    setRestoringId(null);

    if (!res.ok) {
      toast({
        title: "Restore failed",
        description: body.error ?? "Could not restore the selected settings snapshot.",
        variant: "destructive",
      });
      return;
    }

    toast({ title: "Settings restored" });
    router.refresh();
  }

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No settings changes have been logged yet.</p>;
  }

  return (
    <div className="space-y-3">
      {rows.map((entry) => (
        <div key={entry.id} className="rounded-lg border p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{entry.action}</Badge>
                <span className="text-sm font-medium">
                  {entry.user.name?.trim() ? entry.user.name : entry.user.email}
                </span>
                <span className="text-xs text-muted-foreground">
                  {format(new Date(entry.createdAt), "dd MMM yyyy HH:mm")}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {entry.user.email}
                {entry.ipAddress ? ` | ${entry.ipAddress}` : ""}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Changed: {entry.changedKeys.length > 0 ? entry.changedKeys.join(", ") : "Snapshot recorded"}
              </p>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => restoreEntry(entry.id)}
              disabled={restoringId === entry.id}
            >
              <RotateCcw className="mr-1 h-4 w-4" />
              {restoringId === entry.id ? "Restoring..." : "Restore This Version"}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
