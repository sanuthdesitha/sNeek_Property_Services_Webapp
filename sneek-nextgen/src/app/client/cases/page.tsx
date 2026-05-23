"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, MessageSquare, CheckCircle2 } from "lucide-react";

export default function ClientCasesPage() {
  const [cases, setCases] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    fetch("/api/client/cases")
      .then((res) => res.json())
      .then((data) => setCases(data.data?.cases || []))
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const data = {
      subject: formData.get("subject"),
      description: formData.get("description"),
      priority: formData.get("priority") || "MEDIUM",
    };

    try {
      const res = await fetch("/api/client/cases", {
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
          <h1 className="text-2xl font-bold text-text-primary">Cases</h1>
          <p className="text-text-secondary mt-1">Track and manage your support cases</p>
        </div>
      </div>

      {submitted && (
        <Card variant="outlined" className="border-success-500">
          <CardContent className="pt-4 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-success-600" />
            <p className="text-sm text-text-primary">Case created successfully!</p>
          </CardContent>
        </Card>
      )}

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">New Case</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input name="subject" label="Subject" placeholder="Brief description of the issue" required />
            <Textarea name="description" label="Description" placeholder="Provide details about your issue..." required />
            <Button type="submit" loading={loading}><Plus className="h-4 w-4 mr-2" />Create Case</Button>
          </form>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">Case History</CardTitle>
        </CardHeader>
        <CardContent>
          {cases.length > 0 ? (
            <div className="space-y-3">
              {cases.map((c: any, i: number) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900">
                  <div className="flex items-center gap-3">
                    <MessageSquare className="h-5 w-5 text-text-tertiary" />
                    <div>
                      <p className="text-sm font-medium">{c.subject}</p>
                      <p className="text-xs text-text-tertiary">{c.description?.substring(0, 50)}...</p>
                    </div>
                  </div>
                  <Badge variant={c.status === "OPEN" ? "warning" : "success"}>{c.status}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-tertiary text-center py-4">No cases yet</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
