"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function NewJobPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const data = {
      propertyId: formData.get("propertyId"),
      jobType: formData.get("jobType"),
      scheduledDate: formData.get("scheduledDate"),
      dueTime: formData.get("dueTime"),
      startTime: formData.get("startTime"),
      endTime: formData.get("endTime"),
      estimatedHours: parseFloat(formData.get("estimatedHours") as string) || 0,
      assignedCleanerId: formData.get("assignedCleanerId") || null,
      notes: formData.get("notes") || null,
      internalNotes: formData.get("internalNotes") || null,
    };

    try {
      const res = await fetch("/api/admin/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create job");
      }

      router.push("/admin/jobs");
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create job");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild><Link href="/admin/jobs"><ArrowLeft className="h-4 w-4 mr-1" />Back</Link></Button>
        <div><h1 className="text-2xl font-bold text-text-primary">Create New Job</h1><p className="text-text-secondary mt-1">Schedule a new cleaning job</p></div>
      </div>
      <Card variant="outlined">
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-lg bg-danger-50 p-3 text-sm text-danger-700 dark:bg-danger-900/30 dark:text-danger-400">
                {error}
              </div>
            )}
            <Select name="propertyId" label="Property" options={[{ value: "prop_001", label: "Harbour View Apartment" }, { value: "prop_002", label: "Beach House" }]} placeholder="Select property" required />
            <Select name="jobType" label="Service Type" options={[{ value: "AIRBNB_TURNOVER", label: "Airbnb Turnover" }, { value: "DEEP_CLEAN", label: "Deep Clean" }, { value: "END_OF_LEASE", label: "End of Lease" }, { value: "GENERAL_CLEAN", label: "General Clean" }]} placeholder="Select type" required />
            <div className="grid grid-cols-2 gap-4"><Input name="scheduledDate" label="Scheduled Date" type="date" required /><Input name="dueTime" label="Due Time" type="time" /></div>
            <div className="grid grid-cols-2 gap-4"><Input name="startTime" label="Start Time" type="time" /><Input name="endTime" label="End Time" type="time" /></div>
            <Input name="estimatedHours" label="Estimated Hours" type="number" step="0.5" placeholder="3" />
            <Select name="assignedCleanerId" label="Assign Cleaner" options={[{ value: "cleaner_001", label: "John C." }, { value: "cleaner_002", label: "Jane S." }]} placeholder="Select cleaner (optional)" />
            <Textarea name="notes" label="Notes" placeholder="Any special instructions..." />
            <Textarea name="internalNotes" label="Internal Notes" placeholder="Notes visible only to admin..." />
            <Button type="submit" className="w-full" loading={loading}>Create Job</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
