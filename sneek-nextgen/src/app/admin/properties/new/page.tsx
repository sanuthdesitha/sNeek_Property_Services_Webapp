"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function NewPropertyPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const data = {
      clientId: formData.get("clientId"),
      name: formData.get("name"),
      address: formData.get("address"),
      suburb: formData.get("suburb"),
      state: formData.get("state") || "NSW",
      postcode: formData.get("postcode"),
      bedrooms: parseInt(formData.get("bedrooms") as string) || 1,
      bathrooms: parseInt(formData.get("bathrooms") as string) || 1,
      hasBalcony: formData.get("hasBalcony") === "on",
      laundryEnabled: formData.get("laundryEnabled") === "on",
      inventoryEnabled: formData.get("inventoryEnabled") === "on",
      accessCode: formData.get("accessCode"),
      keyLocation: formData.get("keyLocation"),
      accessNotes: formData.get("accessNotes"),
      notes: formData.get("notes"),
    };

    try {
      const res = await fetch("/api/admin/properties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create property");
      }

      router.push("/admin/properties");
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create property");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild><Link href="/admin/properties"><ArrowLeft className="h-4 w-4 mr-1" />Back</Link></Button>
        <div><h1 className="text-2xl font-bold text-text-primary">Add Property</h1><p className="text-text-secondary mt-1">Register a new property</p></div>
      </div>

      <Card variant="outlined">
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-lg bg-danger-50 p-3 text-sm text-danger-700 dark:bg-danger-900/30 dark:text-danger-400">{error}</div>
            )}
            <Select name="clientId" label="Client" options={[{ value: "client_001", label: "Harbour Properties Pty Ltd" }]} placeholder="Select client" required />
            <Input name="name" label="Property Name" placeholder="e.g., Harbour View Apartment" required />
            <Input name="address" label="Address" placeholder="123 Harbour Street" required />
            <div className="grid grid-cols-3 gap-4">
              <Input name="suburb" label="Suburb" placeholder="Sydney" required />
              <Input name="state" label="State" placeholder="NSW" />
              <Input name="postcode" label="Postcode" placeholder="2000" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input name="bedrooms" label="Bedrooms" type="number" min={1} placeholder="2" />
              <Input name="bathrooms" label="Bathrooms" type="number" min={1} placeholder="1" />
            </div>
            <div className="space-y-3">
              <Switch name="hasBalcony" label="Has Balcony" />
              <Switch name="laundryEnabled" label="Laundry Enabled" defaultChecked />
              <Switch name="inventoryEnabled" label="Inventory Tracking Enabled" defaultChecked />
            </div>
            <Separator />
            <h3 className="text-sm font-medium">Access Details</h3>
            <Input name="accessCode" label="Access Code" placeholder="e.g., 1234" />
            <Input name="keyLocation" label="Key Location" placeholder="e.g., Lockbox at front door" />
            <Textarea name="accessNotes" label="Access Notes" placeholder="Special access instructions..." />
            <Separator />
            <Textarea name="notes" label="General Notes" placeholder="Any additional notes..." />
            <Button type="submit" className="w-full" loading={loading}>Create Property</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
