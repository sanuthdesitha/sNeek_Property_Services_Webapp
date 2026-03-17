"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";

interface JobOption {
  id: string;
  label: string;
}

export function CleanerLostFoundPage({ jobs }: { jobs: JobOption[] }) {
  const [jobId, setJobId] = useState<string>(jobs[0]?.id ?? "");
  const [itemName, setItemName] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [savingLostFound, setSavingLostFound] = useState(false);

  async function submitLostFound() {
    if (!jobId || !itemName.trim() || !location.trim() || !notes.trim()) {
      toast({ title: "Complete all fields", variant: "destructive" });
      return;
    }
    setSavingLostFound(true);
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
    setSavingLostFound(false);
    if (!res.ok) {
      toast({ title: "Could not submit", description: body.error ?? "Failed.", variant: "destructive" });
      return;
    }
    setItemName("");
    setLocation("");
    setNotes("");
    toast({
      title: "Lost & found reported",
      description:
        body.notificationWarning ??
        "A case was opened and admin has been notified.",
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">Lost &amp; Found</h1>
        <p className="text-sm text-muted-foreground">
          Report an item found during a job. This opens a case for admin follow-up.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Submit Lost &amp; Found Case</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">Job</Label>
            <Select value={jobId} onValueChange={setJobId}>
              <SelectTrigger>
                <SelectValue placeholder="Select job" />
              </SelectTrigger>
              <SelectContent>
                {jobs.map((job) => (
                  <SelectItem key={job.id} value={job.id}>
                    {job.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Item name</Label>
            <Input placeholder="Item name" value={itemName} onChange={(e) => setItemName(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Where found</Label>
            <Input placeholder="Where found" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Notes</Label>
            <Textarea placeholder="Notes for admin/client" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <Button onClick={submitLostFound} disabled={savingLostFound || !jobs.length} className="w-full">
            {savingLostFound ? "Submitting..." : "Submit Lost & Found"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
