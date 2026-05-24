"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";

type Theme = {
  id: string;
  name: string;
  kind: string;
  isDefault: boolean;
  isActive: boolean;
  updatedAt: string;
};

export default function ReportThemesPage() {
  const [themes, setThemes] = useState<Theme[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/admin/report-themes");
    const data = await res.json().catch(() => ({}));
    setThemes(Array.isArray(data?.themes) ? data.themes : []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function setDefault(id: string) {
    setBusy(id);
    const res = await fetch(`/api/admin/report-themes/${id}/set-default`, { method: "POST" });
    setBusy(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast({ title: "Could not set default", description: body.error ?? "Try again", variant: "destructive" });
      return;
    }
    toast({ title: "Default theme updated" });
    load();
  }

  async function createTheme() {
    setBusy("__new__");
    const res = await fetch("/api/admin/report-themes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New theme" }),
    });
    setBusy(null);
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.theme) {
      toast({ title: "Could not create theme", description: body.error ?? "Try again", variant: "destructive" });
      return;
    }
    window.location.href = `/admin/reports/themes/${body.theme.id}/edit`;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Report themes</h2>
          <p className="text-sm text-muted-foreground">
            Customize report layout, photo size, and branding.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/admin/reports">Back to reports</Link>
          </Button>
          <Button onClick={createTheme} disabled={busy === "__new__"}>
            {busy === "__new__" ? "Creating..." : "New theme"}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Loading themes...</p>
          ) : themes.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No themes yet. Create one to get started.
            </p>
          ) : (
            <div className="divide-y">
              {themes.map((t) => (
                <div key={t.id} className="flex items-center justify-between px-6 py-3">
                  <div className="flex items-center gap-3">
                    <div>
                      <p className="font-medium text-sm">{t.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.kind} · updated {new Date(t.updatedAt).toLocaleDateString()}
                      </p>
                    </div>
                    {t.isDefault && (
                      <Badge variant="success" className="text-xs">
                        Default
                      </Badge>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {!t.isDefault && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === t.id}
                        onClick={() => setDefault(t.id)}
                      >
                        Set as default
                      </Button>
                    )}
                    <Button size="sm" asChild>
                      <Link href={`/admin/reports/themes/${t.id}/edit`}>Edit</Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
