"use client";

import { useState } from "react";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";

type CleanerOption = {
  id: string;
  name: string | null;
  email: string;
};

export function PreferredCleanerCard({
  propertyId,
  currentCleanerId,
  options,
}: {
  propertyId: string;
  currentCleanerId?: string | null;
  options: CleanerOption[];
}) {
  const [selectedId, setSelectedId] = useState(currentCleanerId ?? "none");
  const [saving, setSaving] = useState(false);

  async function savePreference() {
    setSaving(true);
    try {
      const response = await fetch(`/api/client/properties/${propertyId}/preferred-cleaner`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preferredCleanerUserId: selectedId === "none" ? null : selectedId,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error ?? "Could not save preferred cleaner.");
      }
      toast({
        title: "Preferred cleaner updated",
        description: body.preferredCleanerName
          ? `${body.preferredCleanerName} will be prioritised when available.`
          : "No preferred cleaner is set for this property.",
      });
    } catch (error: any) {
      toast({
        title: "Update failed",
        description: error?.message ?? "Could not save preferred cleaner.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Preferred cleaner</CardTitle>
        <CardDescription>
          Choose a cleaner who has already worked at this property so new jobs can be prioritised to them when available.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <select
          className="flex h-11 w-full rounded-2xl border border-input bg-background px-3 text-sm"
          value={selectedId}
          onChange={(event) => setSelectedId(event.target.value)}
        >
          <option value="none">No preferred cleaner</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name?.trim() || option.email}
            </option>
          ))}
        </select>
        <div className="flex justify-end">
          <Button onClick={savePreference} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save preference
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
