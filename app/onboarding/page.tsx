"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

type OnboardingResponse = {
  user: {
    id: string;
    name: string | null;
    email: string;
    phone: string | null;
    role: "ADMIN" | "OPS_MANAGER" | "CLEANER" | "CLIENT" | "LAUNDRY";
  };
  extendedProfile: {
    businessName: string | null;
    abn: string | null;
    address: string | null;
    contactNumber: string | null;
    bankDetails: {
      accountName: string;
      bankName: string;
      bsb: string;
      accountNumber: string;
    } | null;
  } | null;
  state: {
    requiresOnboarding: boolean;
    tutorialSeen: boolean;
  };
  missingFields: string[];
  onboardingComplete: boolean;
};

const TOUR_STEPS = [
  {
    title: "Welcome",
    body: "This quick walkthrough shows where jobs, reports, and settings live.",
  },
  {
    title: "Navigation",
    body: "Use the left menu for portal modules and top-right notifications for live updates.",
  },
  {
    title: "Job Workflow",
    body: "Jobs move from Unassigned to Completed with forms, media evidence, and QA checks.",
  },
  {
    title: "You're Ready",
    body: "Save required profile details now. You can edit them later in Settings.",
  },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<OnboardingResponse | null>(null);
  const [tourStep, setTourStep] = useState(0);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    address: "",
    businessName: "",
    abn: "",
    accountName: "",
    bankName: "",
    bsb: "",
    accountNumber: "",
  });

  const role = data?.user.role;
  const needsBusiness = role === "CLIENT" || role === "LAUNDRY";
  const needsBank = role === "CLEANER" || role === "LAUNDRY";
  const tutorialDone = data?.state.tutorialSeen || tourStep >= TOUR_STEPS.length;

  useEffect(() => {
    async function load() {
      setLoading(true);
      const res = await fetch("/api/me/onboarding", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as OnboardingResponse;
      if (!res.ok) {
        setError((body as any).error ?? "Failed to load onboarding.");
        setLoading(false);
        return;
      }
      setData(body);
      setTourStep(body.state.tutorialSeen ? TOUR_STEPS.length : 0);
      setForm({
        name: body.user.name ?? "",
        phone: body.extendedProfile?.contactNumber ?? body.user.phone ?? "",
        address: body.extendedProfile?.address ?? "",
        businessName: body.extendedProfile?.businessName ?? "",
        abn: body.extendedProfile?.abn ?? "",
        accountName: body.extendedProfile?.bankDetails?.accountName ?? "",
        bankName: body.extendedProfile?.bankDetails?.bankName ?? "",
        bsb: body.extendedProfile?.bankDetails?.bsb ?? "",
        accountNumber: body.extendedProfile?.bankDetails?.accountNumber ?? "",
      });
      setLoading(false);
    }
    load();
  }, []);

  const missingFieldsLabel = useMemo(() => {
    if (!data?.missingFields?.length) return "None";
    const labels = data.missingFields.map((field) => {
      if (field === "contactNumber") return "phone";
      if (field === "bankDetails") return "bank details";
      if (field === "businessName") return "business name";
      return field;
    });
    return Array.from(new Set(labels)).join(", ");
  }, [data?.missingFields]);

  async function handleSave() {
    setError(null);
    setSaving(true);
    const res = await fetch("/api/me/onboarding", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        phone: form.phone,
        address: form.address,
        businessName: needsBusiness ? form.businessName : undefined,
        abn: needsBusiness ? form.abn : undefined,
        bankDetails: needsBank
          ? {
              accountName: form.accountName,
              bankName: form.bankName,
              bsb: form.bsb,
              accountNumber: form.accountNumber,
            }
          : undefined,
        tutorialSeen: tutorialDone,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as any;
    setSaving(false);
    if (!res.ok) {
      setError(body.error ?? "Could not save onboarding.");
      return;
    }
    if (!body.onboardingComplete) {
      setData((prev) =>
        prev
          ? {
              ...prev,
              missingFields: Array.isArray(body.missingFields) ? body.missingFields : prev.missingFields,
              state: {
                ...prev.state,
                tutorialSeen: body.state?.tutorialSeen ?? prev.state.tutorialSeen,
                requiresOnboarding: body.state?.requiresOnboarding ?? prev.state.requiresOnboarding,
              },
            }
          : prev
      );
      setError("Complete all required fields to continue.");
      return;
    }

    router.push("/");
    router.refresh();
  }

  if (loading) {
    return <div className="py-12 text-center text-sm text-muted-foreground">Loading onboarding...</div>;
  }

  if (!data) {
    return <div className="py-12 text-center text-sm text-destructive">{error ?? "Could not load onboarding."}</div>;
  }

  return (
    <div className="relative mx-auto max-w-3xl space-y-4 p-4">
      {!tutorialDone ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-md animate-in fade-in zoom-in-95 duration-300">
            <CardHeader>
              <CardTitle>{TOUR_STEPS[tourStep].title}</CardTitle>
              <CardDescription>{TOUR_STEPS[tourStep].body}</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Step {tourStep + 1} / {TOUR_STEPS.length}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setTourStep(TOUR_STEPS.length)}>
                  Skip
                </Button>
                <Button onClick={() => setTourStep((prev) => Math.min(TOUR_STEPS.length, prev + 1))}>
                  {tourStep >= TOUR_STEPS.length - 1 ? "Done" : "Next"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Complete Your Account Setup</CardTitle>
          <CardDescription>
            Fill required business/profile details before you can use the portal.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Alert>
            <AlertDescription>
              Missing required fields: <strong>{missingFieldsLabel}</strong>
            </AlertDescription>
          </Alert>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={form.phone} onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Address</Label>
              <Input
                value={form.address}
                onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
              />
            </div>
          </div>

          {needsBusiness ? (
            <>
              <Separator />
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Business name</Label>
                  <Input
                    value={form.businessName}
                    onChange={(e) => setForm((prev) => ({ ...prev, businessName: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>ABN</Label>
                  <Input value={form.abn} onChange={(e) => setForm((prev) => ({ ...prev, abn: e.target.value }))} />
                </div>
              </div>
            </>
          ) : null}

          {needsBank ? (
            <>
              <Separator />
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Account name</Label>
                  <Input
                    value={form.accountName}
                    onChange={(e) => setForm((prev) => ({ ...prev, accountName: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Bank name</Label>
                  <Input
                    value={form.bankName}
                    onChange={(e) => setForm((prev) => ({ ...prev, bankName: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>BSB</Label>
                  <Input value={form.bsb} onChange={(e) => setForm((prev) => ({ ...prev, bsb: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Account number</Label>
                  <Input
                    value={form.accountNumber}
                    onChange={(e) => setForm((prev) => ({ ...prev, accountNumber: e.target.value }))}
                  />
                </div>
              </div>
            </>
          ) : null}

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saving || !tutorialDone}>
              {saving ? "Saving..." : "Save and continue"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
