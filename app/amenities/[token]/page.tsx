"use client";

/**
 * Public (token-gated) amenities survey — a client fills in what their property
 * has so the cleaning checklist can be tailored. No login required; the token
 * is minted by an admin from the property page and expires after 14 days.
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle2, Loader2 } from "lucide-react";

interface SurveyData {
  propertyName: string;
  bedrooms: number;
  bathrooms: number;
  hasBalcony: boolean;
  features: Record<string, boolean>;
  featureDefs: Array<{ key: string; label: string; group: string }>;
  alreadySubmitted: boolean;
}

export default function AmenitiesSurveyPage() {
  const params = useParams();
  const token = String(params.token ?? "");
  const [data, setData] = useState<SurveyData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const [bedrooms, setBedrooms] = useState(1);
  const [bathrooms, setBathrooms] = useState(1);
  const [hasBalcony, setHasBalcony] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch(`/api/public/amenities/${token}`)
      .then((res) => res.json().then((body) => ({ ok: res.ok, body })))
      .then(({ ok, body }) => {
        if (!ok) {
          setError(body.error ?? "This link is invalid or has expired.");
          return;
        }
        setData(body);
        setFeatures(body.features ?? {});
        setBedrooms(body.bedrooms ?? 1);
        setBathrooms(body.bathrooms ?? 1);
        setHasBalcony(body.hasBalcony === true);
      })
      .catch(() => setError("This link is invalid or has expired."));
  }, [token]);

  const submit = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/amenities/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ features, bedrooms, bathrooms, hasBalcony }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not save.");
      setDone(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (error) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-lg items-center justify-center p-6">
        <p className="text-center text-sm text-muted-foreground">{error}</p>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-lg items-center justify-center p-6">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </main>
    );
  }
  if (done) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-lg items-center justify-center p-6">
        <Card className="w-full">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-500" />
            <p className="text-lg font-semibold">Thank you!</p>
            <p className="text-sm text-muted-foreground">
              We&apos;ve saved the details for {data.propertyName}. Your cleaning checklist will be tailored to
              exactly what your property has.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  const groups = Array.from(new Set(data.featureDefs.map((f) => f.group)));

  return (
    <main className="mx-auto max-w-lg space-y-4 p-4 py-8">
      <div className="text-center">
        <h1 className="text-xl font-semibold">Tell us about {data.propertyName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tick everything your property has so our cleaning checklist matches it exactly. Takes under a minute.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Rooms</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Bedrooms</Label>
            <Input
              type="number"
              min={0}
              max={30}
              value={bedrooms}
              onChange={(event) => setBedrooms(Math.max(0, Number(event.target.value) || 0))}
            />
          </div>
          <div>
            <Label className="text-xs">Bathrooms</Label>
            <Input
              type="number"
              min={0}
              max={30}
              value={bathrooms}
              onChange={(event) => setBathrooms(Math.max(0, Number(event.target.value) || 0))}
            />
          </div>
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <Checkbox checked={hasBalcony} onCheckedChange={(checked) => setHasBalcony(checked === true)} />
            Balcony or terrace
          </label>
        </CardContent>
      </Card>

      {groups.map((group) => (
        <Card key={group}>
          <CardHeader>
            <CardTitle className="text-sm capitalize">{group.toLowerCase()}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-x-4 gap-y-2.5">
            {data.featureDefs
              .filter((f) => f.group === group)
              .map((feature) => (
                <label key={feature.key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={features[feature.key] === true}
                    onCheckedChange={(checked) =>
                      setFeatures((prev) => ({ ...prev, [feature.key]: checked === true }))
                    }
                  />
                  {feature.label}
                </label>
              ))}
          </CardContent>
        </Card>
      ))}

      <Button className="w-full" size="lg" onClick={submit} disabled={submitting}>
        {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        {data.alreadySubmitted ? "Update details" : "Submit"}
      </Button>
    </main>
  );
}
