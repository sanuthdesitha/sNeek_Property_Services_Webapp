"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Plus, AlertTriangle, CheckCircle2 } from "lucide-react";

export default function ClientDisputesPage() {
  const [disputes, setDisputes] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    fetch("/api/client/disputes")
      .then((res) => res.json())
      .then((data) => setDisputes(data.data?.disputes || []))
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const data = {
      jobId: formData.get("jobId") || null,
      type: formData.get("type"),
      description: formData.get("description"),
    };

    try {
      const res = await fetch("/api/client/disputes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (res.ok) {
        setSubmitted(true);
        setTimeout(() => setSubmitted(false), 3000);
        e.currentTarget.reset();
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Disputes</h1>
          <p className="text-text-secondary mt-1">Raise and track disputes</p>
        </div>
      </div>

      {submitted && (
        <Card variant="outlined" className="border-success-500">
          <CardContent className="pt-4 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-success-600" />
            <p className="text-sm text-text-primary">Dispute submitted successfully!</p>
          </CardContent>
        </Card>
      )}

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">New Dispute</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input name="jobId" label="Job Number (optional)" placeholder="e.g., SNK-ABC123" />
            <Select name="type" label="Dispute Type" options={[
              { value: "QUALITY", label: "Quality Issue" },
              { value: "BILLING", label: "Billing Dispute" },
              { value: "DAMAGE", label: "Property Damage" },
              { value: "OTHER", label: "Other" },
            ]} placeholder="Select type" required />
            <Textarea name="description" label="Description" placeholder="Describe the issue in detail..." required />
            <Button type="submit" loading={loading}><Plus className="h-4 w-4 mr-2" />Submit Dispute</Button>
          </form>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">Dispute History</CardTitle>
        </CardHeader>
        <CardContent>
          {disputes.length > 0 ? (
            <div className="space-y-3">
              {disputes.map((d: any, i: number) => (
                <div key={i} className="flex items-start justify-between p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-warning-500 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">{d.type}</p>
                      <p className="text-xs text-text-tertiary">{d.description?.substring(0, 50)}...</p>
                    </div>
                  </div>
                  <Badge variant={d.status === "RESOLVED" ? "success" : "warning"}>{d.status}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-tertiary text-center py-4">No disputes yet</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
