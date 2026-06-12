"use client";

import { useEffect, useMemo, useState } from "react";
import { JobType } from "@prisma/client";
import { ClipboardCheck, Plus, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { buildDefaultQaTemplateSchema, jobTypeLabel } from "@/lib/qa/templates";

export function AdminQaTemplatesClient() {
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<any[]>([]);
  const [properties, setProperties] = useState<any[]>([]);
  const [serviceType, setServiceType] = useState<JobType>(JobType.AIRBNB_TURNOVER);
  const [propertyId, setPropertyId] = useState("__global");
  const [name, setName] = useState("");
  const [schemaText, setSchemaText] = useState("");

  async function load() {
    setLoading(true);
    const res = await fetch("/api/admin/qa/templates", { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      toast({ title: "Could not load QA templates", description: body.error ?? "Please retry.", variant: "destructive" });
      return;
    }
    setTemplates(body.templates ?? []);
    setProperties(body.properties ?? []);
  }

  useEffect(() => {
    setSchemaText(JSON.stringify(buildDefaultQaTemplateSchema(serviceType), null, 2));
  }, [serviceType]);

  useEffect(() => {
    void load();
  }, []);

  const grouped = useMemo(() => templates, [templates]);

  async function createTemplate() {
    let parsedSchema: unknown;
    try {
      parsedSchema = JSON.parse(schemaText);
    } catch {
      toast({ title: "Invalid schema JSON", variant: "destructive" });
      return;
    }
    const res = await fetch("/api/admin/qa/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim() || undefined,
        serviceType,
        propertyId: propertyId === "__global" ? null : propertyId,
        templateSchema: parsedSchema,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Template create failed", description: body.error ?? "Please retry.", variant: "destructive" });
      return;
    }
    toast({ title: "QA template created" });
    setName("");
    await load();
  }

  async function toggleTemplate(template: any) {
    const res = await fetch(`/api/admin/qa/templates/${template.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !template.isActive }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast({ title: "Update failed", description: body.error ?? "Please retry.", variant: "destructive" });
      return;
    }
    await load();
  }

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<ClipboardCheck />}
        title="QA Forms"
        actions={
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
        <Card>
          <CardHeader><CardTitle className="text-base">Create QA template</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Default QA - Airbnb turnover" />
            </div>
            <div className="space-y-1.5">
              <Label>Job type</Label>
              <Select value={serviceType} onValueChange={(value) => setServiceType(value as JobType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.values(JobType).map((type) => (
                    <SelectItem key={type} value={type}>{jobTypeLabel(type)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Property override</Label>
              <Select value={propertyId} onValueChange={setPropertyId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__global">Global default</SelectItem>
                  {properties.map((property) => (
                    <SelectItem key={property.id} value={property.id}>
                      {property.name} ({property.suburb})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Schema JSON</Label>
              <Textarea value={schemaText} onChange={(event) => setSchemaText(event.target.value)} className="min-h-[280px] font-mono text-xs" />
            </div>
            <Button className="w-full" onClick={() => void createTemplate()}>
              <Plus className="mr-2 h-4 w-4" />
              Create template
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-3">
          {grouped.length === 0 ? (
            <Card><CardContent className="p-6 text-sm text-muted-foreground">No QA templates yet.</CardContent></Card>
          ) : (
            grouped.map((template) => (
              <Card key={template.id}>
                <CardContent className="grid gap-3 p-4 lg:grid-cols-[1fr_auto] lg:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <ClipboardCheck className="h-4 w-4 text-primary" />
                      <p className="font-semibold">{template.name}</p>
                      <Badge variant={template.isActive ? "success" : "secondary"}>
                        {template.isActive ? "Active" : "Inactive"}
                      </Badge>
                      <Badge variant="outline">v{template.version}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {jobTypeLabel(template.serviceType)}
                      {template.property ? ` · ${template.property.name} (${template.property.suburb})` : " · Global default"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground">Active</Label>
                    <Switch checked={template.isActive} onCheckedChange={() => void toggleTemplate(template)} />
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
