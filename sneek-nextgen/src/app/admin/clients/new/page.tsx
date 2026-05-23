"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function NewClientPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const data = {
      name: formData.get("name"),
      email: formData.get("email"),
      phone: formData.get("phone"),
      address: formData.get("address"),
      notes: formData.get("notes"),
    };

    try {
      const res = await fetch("/api/admin/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create client");
      }

      router.push("/admin/clients");
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create client");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" asChild><Link href="/admin/clients"><ArrowLeft className="h-4 w-4 mr-1" />Back</Link></Button>
        <div><h1 className="text-2xl font-bold text-text-primary">Add Client</h1><p className="text-text-secondary mt-1">Register a new client</p></div>
      </div>

      <Card variant="outlined">
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-lg bg-danger-50 p-3 text-sm text-danger-700 dark:bg-danger-900/30 dark:text-danger-400">{error}</div>
            )}
            <Input name="name" label="Client Name" placeholder="e.g., Harbour Properties Pty Ltd" required />
            <Input name="email" label="Email" type="email" placeholder="client@example.com" required />
            <Input name="phone" label="Phone" type="tel" placeholder="+61 400 000 000" />
            <Input name="address" label="Address" placeholder="Suite 5, 100 George St, Sydney" />
            <Textarea name="notes" label="Notes" placeholder="Any additional notes..." />
            <Button type="submit" className="w-full" loading={loading}>Create Client</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
