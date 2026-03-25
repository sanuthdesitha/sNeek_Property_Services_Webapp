"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { GoogleAddressInput } from "@/components/shared/google-address-input";
import { toast } from "@/hooks/use-toast";

export function NewClientForm() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    address: "",
    notes: "",
    sendPortalInvite: false,
    welcomeNote: "",
  });

  async function createClient() {
    if (!form.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    if (form.sendPortalInvite && !form.email.trim()) {
      toast({ title: "Email is required to send an invite", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/admin/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error ?? "Failed to create client.");
      }

      toast({
        title: payload.invited ? "Client created and invited" : "Client created",
        description: payload.warning ?? undefined,
        variant: payload.warning ? "destructive" : "default",
      });
      router.push(`/admin/clients/${payload.id}`);
      router.refresh();
    } catch (err: any) {
      toast({
        title: "Create failed",
        description: err.message ?? "Failed to create client.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Add Client</h2>
          <p className="text-sm text-muted-foreground">Create a new client account and profile.</p>
        </div>
        <Button asChild variant="outline">
          <Link href="/admin/clients">Back</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Client Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Harbour View Stays"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                placeholder="owner@example.com"
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                type="tel"
                inputMode="tel"
                maxLength={16}
                value={form.phone}
                onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
                placeholder="0451217210 or +61451217210"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="address">Address</Label>
              <GoogleAddressInput
                id="address"
                value={form.address}
                onChange={(value) => setForm((prev) => ({ ...prev, address: value }))}
                placeholder="1 Example St, Sydney NSW"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={form.notes}
              onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
              placeholder="Internal notes about this client..."
            />
          </div>

          <div className="rounded-xl border border-border/70 bg-muted/20 p-4 space-y-3">
            <div className="flex items-start gap-3">
              <Checkbox
                id="sendPortalInvite"
                checked={form.sendPortalInvite}
                onCheckedChange={(checked) =>
                  setForm((prev) => ({ ...prev, sendPortalInvite: checked === true }))
                }
              />
              <div className="space-y-1">
                <Label htmlFor="sendPortalInvite" className="cursor-pointer">
                  Send portal invite
                </Label>
                <p className="text-xs text-muted-foreground">
                  Create a linked client portal account and email them a temporary password to complete setup.
                </p>
              </div>
            </div>

            {form.sendPortalInvite ? (
              <div className="space-y-1.5">
                <Label htmlFor="welcomeNote">Welcome note</Label>
                <Textarea
                  id="welcomeNote"
                  value={form.welcomeNote}
                  onChange={(e) => setForm((prev) => ({ ...prev, welcomeNote: e.target.value }))}
                  placeholder="Welcome to sNeek Property Services. Please sign in, reset your password, and complete your account details."
                />
              </div>
            ) : null}
          </div>

          <div className="flex justify-end">
            <Button onClick={createClient} disabled={saving}>
              {saving ? "Creating..." : "Create client"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
