"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Plus, Scale, CheckCircle2 } from "lucide-react";

export default function PayRequestsPage() {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    fetch("/api/cleaner/pay-requests")
      .then((res) => res.json())
      .then((data) => setRequests(data.data?.requests || []))
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const data = {
      type: formData.get("type"),
      requestedHours: parseFloat(formData.get("requestedHours") as string) || null,
      requestedRate: parseFloat(formData.get("requestedRate") as string) || null,
      reason: formData.get("reason"),
    };

    try {
      const res = await fetch("/api/cleaner/pay-requests", {
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
          <h1 className="text-2xl font-bold text-text-primary">Pay Requests</h1>
          <p className="text-text-secondary mt-1">Request pay adjustments for extra work</p>
        </div>
      </div>

      {submitted && (
        <Card variant="outlined" className="border-success-500">
          <CardContent className="pt-4 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-success-600" />
            <p className="text-sm text-text-primary">Pay request submitted successfully!</p>
          </CardContent>
        </Card>
      )}

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">New Pay Adjustment Request</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Select name="type" label="Type" options={[{ value: "HOURLY", label: "Hourly" }, { value: "FIXED", label: "Fixed Amount" }]} placeholder="Select type" required />
            <Input name="requestedHours" label="Requested Hours" type="number" step="0.5" placeholder="2" />
            <Input name="requestedRate" label="Requested Rate" type="number" placeholder="32" />
            <Textarea name="reason" label="Reason" placeholder="Explain why you need a pay adjustment..." required />
            <Button type="submit" loading={loading}><Plus className="h-4 w-4 mr-2" />Submit Request</Button>
          </form>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">Request History</CardTitle>
        </CardHeader>
        <CardContent>
          {requests.length > 0 ? (
            <div className="space-y-3">
              {requests.map((req: any, i: number) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900">
                  <div className="flex items-center gap-3">
                    <Scale className="h-5 w-5 text-text-tertiary" />
                    <div>
                      <p className="text-sm font-medium">{req.type}</p>
                      <p className="text-xs text-text-tertiary">{req.reason?.substring(0, 50)}...</p>
                    </div>
                  </div>
                  <Badge variant={req.status === "APPROVED" ? "success" : req.status === "REJECTED" ? "danger" : "warning"}>{req.status}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-tertiary text-center py-4">No pay requests yet</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
