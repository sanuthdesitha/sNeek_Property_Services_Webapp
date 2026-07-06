"use client";

/**
 * ESTATE new-client form — v2-native replacement for the v1 NewClientForm.
 * Same endpoint (POST /api/admin/clients) and payload shape; brand-new Estate
 * UI built purely on the v2 primitives + estate-kit. No Google Places widget
 * (that lives in the forbidden components/shared/*); a plain structured address
 * block posts the same fields the API accepts (address/suburb/state/postcode).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { UserRoundPlus } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
} from "@/components/v2/ui/primitives";
import { EField, EInput, ETextarea, ESwitch } from "@/components/v2/admin/estate-kit";

type ClientForm = {
  name: string;
  email: string;
  phone: string;
  address: string;
  suburb: string;
  state: string;
  postcode: string;
  latitude: number | null;
  longitude: number | null;
  placeId: string | null;
  notes: string;
  sendPortalInvite: boolean;
  welcomeNote: string;
};

export function NewClientForm() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<ClientForm>({
    name: "",
    email: "",
    phone: "",
    address: "",
    suburb: "",
    state: "",
    postcode: "",
    latitude: null,
    longitude: null,
    placeId: null,
    notes: "",
    sendPortalInvite: false,
    welcomeNote: "",
  });

  function set<K extends keyof ClientForm>(key: K, value: ClientForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

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
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload.error ?? "Failed to create client.");
      }
      toast({
        title: payload.invited ? "Client created and invited" : "Client created",
        description: payload.warning ?? undefined,
        variant: payload.warning ? "destructive" : "default",
      });
      router.push(`/v2/admin/clients/${payload.id}`);
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
      <div className="flex justify-end">
        <EButton asChild variant="outline" size="sm">
          <Link href="/v2/admin/clients">Back to register</Link>
        </EButton>
      </div>

      <ECard>
        <ECardHeader>
          <ECardTitle>Client details</ECardTitle>
        </ECardHeader>
        <ECardBody className="space-y-5 pt-0">
          <div className="grid gap-4 md:grid-cols-2">
            <EField label="Name">
              <EInput
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Harbour View Stays"
              />
            </EField>
            <EField label="Email">
              <EInput
                type="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                placeholder="owner@example.com"
              />
            </EField>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <EField label="Phone">
              <EInput
                type="tel"
                inputMode="tel"
                maxLength={16}
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                placeholder="0451217210 or +61451217210"
              />
            </EField>
            <EField label="Street address">
              <EInput
                value={form.address}
                onChange={(e) => set("address", e.target.value)}
                placeholder="1 Example St"
              />
            </EField>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <EField label="Suburb">
              <EInput
                value={form.suburb}
                onChange={(e) => set("suburb", e.target.value)}
                placeholder="Sydney"
              />
            </EField>
            <EField label="State">
              <EInput
                value={form.state}
                onChange={(e) => set("state", e.target.value)}
                placeholder="NSW"
              />
            </EField>
            <EField label="Postcode">
              <EInput
                inputMode="numeric"
                maxLength={4}
                value={form.postcode}
                onChange={(e) => set("postcode", e.target.value)}
                placeholder="2000"
              />
            </EField>
          </div>

          <EField label="Notes">
            <ETextarea
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Internal notes about this client…"
            />
          </EField>

          <div className="space-y-3 rounded-[var(--e-radius-lg)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] p-4">
            <ESwitch
              checked={form.sendPortalInvite}
              onCheckedChange={(v) => set("sendPortalInvite", v)}
              label="Send portal invite"
            />
            <p className="pl-11 text-[0.75rem] text-[hsl(var(--e-text-faint))]">
              Create a linked client portal account and email them a temporary password to complete setup.
            </p>
            {form.sendPortalInvite ? (
              <EField label="Welcome note" className="pl-11">
                <ETextarea
                  value={form.welcomeNote}
                  onChange={(e) => set("welcomeNote", e.target.value)}
                  placeholder="Welcome to sNeek Property Services. Please sign in, reset your password, and complete your account details."
                />
              </EField>
            ) : null}
          </div>

          <div className="flex justify-end">
            <EButton variant="gold" onClick={createClient} disabled={saving}>
              <UserRoundPlus className="h-4 w-4" />
              {saving ? "Creating…" : "Create client"}
            </EButton>
          </div>
        </ECardBody>
      </ECard>
    </div>
  );
}
