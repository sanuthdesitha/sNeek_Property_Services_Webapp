"use client";

/**
 * Estate cleaner lost & found log. Same endpoint + payload as the live workspace
 * (components/cleaner/lost-found-page.tsx):
 *   POST /api/cleaner/lost-found  { jobId, itemName, location, notes }
 *
 * The endpoint opens an admin case and emails admins; it is POST-only (there is
 * no history/list endpoint and the schema takes no photo), so this Estate view
 * mirrors that surface exactly — a single log form with a session-scoped recap
 * of what was reported this visit.
 */
import { useState } from "react";
import { PackageSearch } from "lucide-react";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
} from "@/components/v2/ui/primitives";
import { EField, EInput, ESelect, ETextarea } from "@/components/v2/cleaner/fields";
import { toast } from "@/hooks/use-toast";

interface JobOption {
  id: string;
  label: string;
}

interface LoggedCase {
  ticketId: string;
  jobLabel: string;
  itemName: string;
  location: string;
  loggedAt: string;
}

export function LostFoundForm({ jobs }: { jobs: JobOption[] }) {
  const [jobId, setJobId] = useState<string>(jobs[0]?.id ?? "");
  const [itemName, setItemName] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [logged, setLogged] = useState<LoggedCase[]>([]);

  async function submit() {
    if (!jobId || !itemName.trim() || !location.trim() || !notes.trim()) {
      toast({ title: "Complete all fields", variant: "destructive" });
      return;
    }
    setSaving(true);
    const res = await fetch("/api/cleaner/lost-found", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId,
        itemName: itemName.trim(),
        location: location.trim(),
        notes: notes.trim(),
      }),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      toast({ title: "Could not submit", description: body.error ?? "Failed.", variant: "destructive" });
      return;
    }
    setLogged((prev) => [
      {
        ticketId: String(body.ticketId ?? Date.now()),
        jobLabel: jobs.find((j) => j.id === jobId)?.label ?? "Job",
        itemName: itemName.trim(),
        location: location.trim(),
        loggedAt: new Date().toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" }),
      },
      ...prev,
    ]);
    setItemName("");
    setLocation("");
    setNotes("");
    toast({
      title: "Lost & found reported",
      description: body.notificationWarning ?? "A case was opened and admin has been notified.",
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      {/* Log form */}
      <ECard>
        <ECardHeader>
          <ECardTitle>Log a found item</ECardTitle>
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
            Opens a case for admin follow-up and emails the office.
          </p>
        </ECardHeader>
        <ECardBody className="space-y-4">
          <EField label="Job">
            <ESelect value={jobId} onChange={(e) => setJobId(e.target.value)}>
              {jobs.length === 0 ? <option value="">No assigned jobs</option> : null}
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.label}
                </option>
              ))}
            </ESelect>
          </EField>

          <EField label="Item name">
            <EInput
              placeholder="e.g. Silver watch"
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
            />
          </EField>

          <EField label="Where found">
            <EInput
              placeholder="e.g. Master bedroom nightstand"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </EField>

          <EField label="Notes for admin / client">
            <ETextarea
              placeholder="Describe the item and any handling notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </EField>

          <EButton
            variant="gold"
            className="w-full"
            onClick={() => void submit()}
            disabled={saving || jobs.length === 0}
          >
            <PackageSearch className="h-4 w-4" />
            {saving ? "Submitting…" : "Submit lost & found"}
          </EButton>
        </ECardBody>
      </ECard>

      {/* Session recap */}
      <div className="space-y-3">
        <span className="e-eyebrow">REPORTED THIS VISIT</span>
        {logged.length === 0 ? (
          <EEmptyState
            eyebrow="Nothing yet"
            title="No items logged"
            description="Cases you open here appear in this recap and are sent straight to admin."
          />
        ) : (
          <div className="space-y-2">
            {logged.map((c) => (
              <ECard key={c.ticketId}>
                <ECardBody className="space-y-1.5 py-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-[0.9375rem] font-[550]">{c.itemName}</p>
                    <EBadge tone="success" soft>
                      Case opened
                    </EBadge>
                  </div>
                  <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">
                    {c.location} · {c.jobLabel}
                  </p>
                  <p className="text-[0.75rem] text-[hsl(var(--e-text-faint))]">Logged {c.loggedAt}</p>
                </ECardBody>
              </ECard>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
