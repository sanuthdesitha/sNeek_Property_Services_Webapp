"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MapPin, Plus, CheckCircle2 } from "lucide-react";

export default function CleanerLostFoundPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    fetch("/api/cleaner/lost-found")
      .then((res) => res.json())
      .then((data) => setItems(data.data?.items || []))
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const data = {
      propertyId: formData.get("propertyId"),
      description: formData.get("description"),
      locationFound: formData.get("locationFound"),
      notes: formData.get("notes"),
    };

    try {
      const res = await fetch("/api/cleaner/lost-found", {
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
          <h1 className="text-2xl font-bold text-text-primary">Lost & Found</h1>
          <p className="text-text-secondary mt-1">Report items found during cleaning</p>
        </div>
      </div>

      {submitted && (
        <Card variant="outlined" className="border-success-500">
          <CardContent className="pt-4 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-success-600" />
            <p className="text-sm text-text-primary">Item reported successfully!</p>
          </CardContent>
        </Card>
      )}

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">Report a Found Item</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input name="propertyId" label="Property ID" placeholder="Enter property ID" required />
            <Input name="description" label="Item Description" placeholder="Describe the found item" required />
            <Input name="locationFound" label="Location Found" placeholder="e.g., Under the bed in bedroom 2" leftIcon={<MapPin className="h-4 w-4" />} />
            <Textarea name="notes" label="Additional Notes" placeholder="Any additional details..." />
            <Button type="submit" loading={loading}><Plus className="h-4 w-4 mr-2" />Report Item</Button>
          </form>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-base">Reported Items</CardTitle>
        </CardHeader>
        <CardContent>
          {items.length > 0 ? (
            <div className="space-y-3">
              {items.map((item: any, i: number) => (
                <div key={i} className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-900">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{item.description}</p>
                      <p className="text-xs text-text-tertiary">{item.locationFound}</p>
                    </div>
                    <Badge variant={item.status === "RETURNED" ? "success" : "warning"}>{item.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-tertiary text-center py-4">No items reported yet</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
