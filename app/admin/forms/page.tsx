"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Plus, Save, FileText, Download, RefreshCcw, Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TwoStepConfirmDialog } from "@/components/shared/two-step-confirm-dialog";
import { MediaGallery } from "@/components/shared/media-gallery";
import { toast } from "@/hooks/use-toast";

const JOB_TYPES = [
  "AIRBNB_TURNOVER",
  "DEEP_CLEAN",
  "END_OF_LEASE",
  "GENERAL_CLEAN",
  "POST_CONSTRUCTION",
  "PRESSURE_WASH",
  "WINDOW_CLEAN",
  "LAWN_MOWING",
  "SPECIAL_CLEAN",
  "COMMERCIAL_RECURRING",
];

const FIELD_TYPES = ["checkbox", "text", "textarea", "number", "upload", "inventory"];
const PROPERTY_CONDITION_FIELDS = ["hasBalcony", "inventoryEnabled", "bedrooms", "bathrooms"];
const PAGE_SLOTS = ["auto", "checklist", "uploads", "laundry", "submit"] as const;
type PageSlot = (typeof PAGE_SLOTS)[number];

type BuilderCondition =
  | { fieldId: string; value: string | number | boolean }
  | { propertyField: string; value: string | number | boolean };

type BuilderField = {
  id: string;
  label: string;
  type: string;
  required?: boolean;
  page?: PageSlot;
  conditional?: BuilderCondition;
};

type BuilderSection = {
  id: string;
  label: string;
  page?: PageSlot;
  fields: BuilderField[];
};

function normalizePageSlot(input: unknown): PageSlot {
  if (typeof input !== "string") return "auto";
  const trimmed = input.trim().toLowerCase();
  return (PAGE_SLOTS as readonly string[]).includes(trimmed) ? (trimmed as PageSlot) : "auto";
}

function newId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function parseConditionValue(input: string): string | number | boolean {
  const trimmed = input.trim();
  if (trimmed.toLowerCase() === "true") return true;
  if (trimmed.toLowerCase() === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

function emptySection(): BuilderSection {
  return {
    id: newId("sec"),
    label: "New Section",
    page: "auto",
    fields: [],
  };
}

export default function FormsPage() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingCopy, setSavingCopy] = useState(false);
  const [deletingTemplate, setDeletingTemplate] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("new");
  const [templateName, setTemplateName] = useState("New Template");
  const [serviceType, setServiceType] = useState("AIRBNB_TURNOVER");
  const [sections, setSections] = useState<BuilderSection[]>([emptySection()]);
  const [dragSectionIndex, setDragSectionIndex] = useState<number | null>(null);
  const [dragFieldRef, setDragFieldRef] = useState<{ sectionIndex: number; fieldIndex: number } | null>(null);
  const [viewSubmission, setViewSubmission] = useState<any>(null);
  const [activeTab, setActiveTab] = useState("builder");
  const [generatingJobId, setGeneratingJobId] = useState<string | null>(null);

  const isEditing = selectedTemplateId !== "new";

  async function loadTemplates() {
    const res = await fetch("/api/admin/form-templates");
    const data = await res.json();
    setTemplates(Array.isArray(data) ? data : []);
  }

  async function loadSubmissions() {
    const res = await fetch("/api/admin/form-submissions");
    const data = await res.json();
    setSubmissions(Array.isArray(data) ? data : []);
  }

  async function loadAll() {
    setLoading(true);
    await Promise.all([loadTemplates(), loadSubmissions()]);
    setLoading(false);
  }

  useEffect(() => {
    loadAll();
  }, []);

  function applyTemplate(template: any) {
    setSelectedTemplateId(template?.id ?? "new");
    setTemplateName(template?.name ?? "New Template");
    setServiceType(template?.serviceType ?? "AIRBNB_TURNOVER");
    const sourceSections = Array.isArray(template?.schema?.sections) ? template.schema.sections : [];
    const normalized: BuilderSection[] =
      sourceSections.length > 0
        ? sourceSections.map((s: any) => ({
            id: typeof s.id === "string" ? s.id : newId("sec"),
            label: typeof s.label === "string" ? s.label : "Untitled Section",
            page: normalizePageSlot(s.page),
                fields: Array.isArray(s.fields)
                  ? s.fields.map((f: any) => ({
                      id: typeof f.id === "string" ? f.id : newId("field"),
                      label: typeof f.label === "string" ? f.label : "Untitled Field",
                      type: FIELD_TYPES.includes(f.type) ? f.type : "text",
                      required: Boolean(f.required),
                      page: normalizePageSlot(f.page),
                      conditional: typeof f.conditional === "object" ? f.conditional : undefined,
                    }))
                  : [],
          }))
        : [emptySection()];
    setSections(normalized);
  }

  function resetBuilder() {
    setSelectedTemplateId("new");
    setTemplateName("New Template");
    setServiceType("AIRBNB_TURNOVER");
    setSections([emptySection()]);
  }

  function addSection() {
    setSections((prev) => [...prev, emptySection()]);
  }

  function removeSection(sectionIndex: number) {
    setSections((prev) => prev.filter((_, i) => i !== sectionIndex));
  }

  function updateSection(sectionIndex: number, patch: Partial<BuilderSection>) {
    setSections((prev) => prev.map((section, i) => (i === sectionIndex ? { ...section, ...patch } : section)));
  }

  function addField(sectionIndex: number) {
    const field: BuilderField = {
      id: newId("field"),
      label: "New Field",
      type: "checkbox",
      required: false,
    };
    setSections((prev) =>
      prev.map((section, i) => (i === sectionIndex ? { ...section, fields: [...section.fields, field] } : section))
    );
  }

  function updateField(sectionIndex: number, fieldIndex: number, patch: Partial<BuilderField>) {
    setSections((prev) =>
      prev.map((section, i) => {
        if (i !== sectionIndex) return section;
        return {
          ...section,
          fields: section.fields.map((field, j) => (j === fieldIndex ? { ...field, ...patch } : field)),
        };
      })
    );
  }

  function removeField(sectionIndex: number, fieldIndex: number) {
    setSections((prev) =>
      prev.map((section, i) => {
        if (i !== sectionIndex) return section;
        return { ...section, fields: section.fields.filter((_, j) => j !== fieldIndex) };
      })
    );
  }

  function moveSection(from: number, to: number) {
    if (from === to) return;
    setSections((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  function moveField(fromSection: number, fromField: number, toSection: number, toField: number) {
    setSections((prev) => {
      const next = [...prev];
      const sourceFields = [...next[fromSection].fields];
      const [moving] = sourceFields.splice(fromField, 1);
      next[fromSection] = { ...next[fromSection], fields: sourceFields };

      const targetFields = [...next[toSection].fields];
      targetFields.splice(toField, 0, moving);
      next[toSection] = { ...next[toSection], fields: targetFields };
      return next;
    });
  }

  async function saveTemplate() {
    if (!templateName.trim()) {
      toast({ title: "Template name is required.", variant: "destructive" });
      return;
    }

    if (sections.length === 0) {
      toast({ title: "Add at least one section.", variant: "destructive" });
      return;
    }

    const payload = {
      name: templateName.trim(),
      serviceType,
      schema: { sections },
    };

    setSaving(true);
    const res = await fetch(isEditing ? `/api/admin/form-templates/${selectedTemplateId}` : "/api/admin/form-templates", {
      method: isEditing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    setSaving(false);
    if (!res.ok) {
      toast({ title: "Save failed", description: body.error ?? "Could not save template.", variant: "destructive" });
      return;
    }
    toast({ title: isEditing ? "Template updated" : "Template created" });
    await loadTemplates();
    applyTemplate(body);
  }

  async function saveAsCopy() {
    if (!isEditing) return;
    if (!templateName.trim()) {
      toast({ title: "Template name is required.", variant: "destructive" });
      return;
    }

    setSavingCopy(true);
    const payload = {
      name: `${templateName.trim()} Copy`,
      serviceType,
      schema: { sections },
    };
    const res = await fetch("/api/admin/form-templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    setSavingCopy(false);
    if (!res.ok) {
      toast({ title: "Copy failed", description: body.error ?? "Could not create template copy.", variant: "destructive" });
      return;
    }
    toast({ title: "Template copied" });
    await loadTemplates();
    applyTemplate(body);
  }

  async function deleteTemplate() {
    if (!isEditing) return;
    setDeletingTemplate(true);
    const res = await fetch(`/api/admin/form-templates/${selectedTemplateId}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    setDeletingTemplate(false);
    if (!res.ok) {
      toast({ title: "Delete failed", description: body.error ?? "Could not delete template.", variant: "destructive" });
      return;
    }
    toast({ title: "Template deleted" });
    setDeleteOpen(false);
    resetBuilder();
    await loadTemplates();
  }

  async function generateAndDownload(jobId: string) {
    setGeneratingJobId(jobId);
    const res = await fetch(`/api/admin/reports/${jobId}/generate`, { method: "POST" });
    const body = await res.json();
    if (!res.ok) {
      setGeneratingJobId(null);
      toast({ title: "Report generation failed", description: body.error ?? "Try again.", variant: "destructive" });
      return;
    }
    const downloadRes = await fetch(`/api/reports/${jobId}/download`);
    setGeneratingJobId(null);
    if (!downloadRes.ok) {
      const dBody = await downloadRes.json().catch(() => ({}));
      toast({ title: "Download failed", description: dBody.error ?? "Could not download report.", variant: "destructive" });
      return;
    }
    const blob = await downloadRes.blob();
    const contentType = downloadRes.headers.get("content-type") ?? "";
    const ext = contentType.includes("pdf") ? "pdf" : "html";
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `job-report-${jobId}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    toast({ title: "Report downloaded" });
  }

  async function openSubmission(submission: any) {
    const jobId = submission?.jobId;
    if (jobId) {
      await fetch(`/api/admin/reports/${jobId}/generate`, { method: "POST" }).catch(() => null);
    }
    setViewSubmission(submission);
  }

  const sortedTemplates = useMemo(
    () => [...templates].sort((a, b) => a.name.localeCompare(b.name)),
    [templates]
  );
  const allFieldOptions = sections.flatMap((section) =>
    section.fields.map((field) => ({
      id: field.id,
      label: `${section.label}: ${field.label}`,
    }))
  );

  if (loading) {
    return <div className="py-10 text-sm text-muted-foreground">Loading form templates...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Forms</h2>
          <p className="text-sm text-muted-foreground">Drag-and-drop form builder and submission review.</p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setActiveTab("builder");
            resetBuilder();
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          New Template
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="builder">Builder</TabsTrigger>
          <TabsTrigger value="submissions">Submissions ({submissions.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="builder" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Templates</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <button
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                    selectedTemplateId === "new" ? "border-primary bg-primary/5" : "hover:bg-muted"
                  }`}
                  onClick={resetBuilder}
                >
                  New template
                </button>
                {sortedTemplates.map((template) => (
                  <button
                    key={template.id}
                    className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                      selectedTemplateId === template.id ? "border-primary bg-primary/5" : "hover:bg-muted"
                    }`}
                    onClick={() => applyTemplate(template)}
                  >
                    <p className="font-medium">{template.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {template.serviceType.replace(/_/g, " ")} - v{template.version}
                    </p>
                  </button>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Visual Form Builder</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Template name</Label>
                    <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Service type</Label>
                    <Select value={serviceType} onValueChange={setServiceType}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {JOB_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {type.replace(/_/g, " ")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-3">
                  {sections.map((section, sectionIndex) => (
                    <div
                      key={section.id}
                      className="space-y-3 rounded-md border p-3"
                      draggable
                      onDragStart={() => setDragSectionIndex(sectionIndex)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (dragSectionIndex === null) return;
                        moveSection(dragSectionIndex, sectionIndex);
                        setDragSectionIndex(null);
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <Input
                          value={section.label}
                          onChange={(e) => updateSection(sectionIndex, { label: e.target.value })}
                          placeholder="Section title"
                        />
                        <Select
                          value={section.page ?? "auto"}
                          onValueChange={(value: PageSlot) => updateSection(sectionIndex, { page: value })}
                        >
                          <SelectTrigger className="w-44">
                            <SelectValue placeholder="Section page" />
                          </SelectTrigger>
                          <SelectContent>
                            {PAGE_SLOTS.map((slot) => (
                              <SelectItem key={slot} value={slot}>
                                {slot === "auto"
                                  ? "Auto page"
                                  : `${slot.charAt(0).toUpperCase()}${slot.slice(1)} page`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button size="sm" variant="outline" onClick={() => addField(sectionIndex)}>
                          Add field
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => removeSection(sectionIndex)}>
                          Remove
                        </Button>
                      </div>

                      <div className="space-y-2">
                        {section.fields.map((field, fieldIndex) => (
                          <div
                            key={field.id}
                            className="space-y-2 rounded-md border p-2"
                            draggable
                            onDragStart={() => setDragFieldRef({ sectionIndex, fieldIndex })}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => {
                              if (!dragFieldRef) return;
                              moveField(dragFieldRef.sectionIndex, dragFieldRef.fieldIndex, sectionIndex, fieldIndex);
                              setDragFieldRef(null);
                            }}
                          >
                            <div className="grid gap-2 md:grid-cols-[1fr_170px_160px_110px_80px]">
                              <Input
                                value={field.label}
                                onChange={(e) => updateField(sectionIndex, fieldIndex, { label: e.target.value })}
                                placeholder="Field label"
                              />
                              <Select
                                value={field.type}
                                onValueChange={(value) => updateField(sectionIndex, fieldIndex, { type: value })}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {FIELD_TYPES.map((type) => (
                                    <SelectItem key={type} value={type}>
                                      {type}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Select
                                value={field.page ?? "auto"}
                                onValueChange={(value: PageSlot) => updateField(sectionIndex, fieldIndex, { page: value })}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Field page" />
                                </SelectTrigger>
                                <SelectContent>
                                  {PAGE_SLOTS.map((slot) => (
                                    <SelectItem key={`${field.id}-${slot}`} value={slot}>
                                      {slot === "auto"
                                        ? "Auto page"
                                        : `${slot.charAt(0).toUpperCase()}${slot.slice(1)} page`}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <div className="flex items-center justify-between rounded-md border px-2">
                                <Label className="text-xs">Required</Label>
                                <Switch
                                  checked={Boolean(field.required)}
                                  onCheckedChange={(value) => updateField(sectionIndex, fieldIndex, { required: value })}
                                />
                              </div>
                              <Button size="sm" variant="ghost" onClick={() => removeField(sectionIndex, fieldIndex)}>
                                Remove
                              </Button>
                            </div>

                            <div className="grid gap-2 rounded-md border p-2 md:grid-cols-[170px_1fr_180px]">
                              <Select
                                value={
                                  field.conditional
                                    ? "propertyField" in field.conditional
                                      ? "property"
                                      : "field"
                                    : "none"
                                }
                                onValueChange={(mode) => {
                                  if (mode === "none") {
                                    updateField(sectionIndex, fieldIndex, { conditional: undefined });
                                    return;
                                  }
                                  if (mode === "property") {
                                    updateField(sectionIndex, fieldIndex, {
                                      conditional: { propertyField: "hasBalcony", value: true },
                                    });
                                    return;
                                  }
                                  const defaultFieldId =
                                    allFieldOptions.find((option) => option.id !== field.id)?.id ?? field.id;
                                  updateField(sectionIndex, fieldIndex, {
                                    conditional: { fieldId: defaultFieldId, value: true },
                                  });
                                }}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Condition" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">Always visible</SelectItem>
                                  <SelectItem value="field">Depends on field</SelectItem>
                                  <SelectItem value="property">Depends on property</SelectItem>
                                </SelectContent>
                              </Select>

                              {field.conditional && "fieldId" in field.conditional && (
                                <Select
                                  value={field.conditional.fieldId}
                                  onValueChange={(value) =>
                                    updateField(sectionIndex, fieldIndex, {
                                      conditional: {
                                        fieldId: value,
                                        value: field.conditional?.value ?? true,
                                      },
                                    })
                                  }
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select dependency field" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {allFieldOptions
                                      .filter((option) => option.id !== field.id)
                                      .map((option) => (
                                        <SelectItem key={option.id} value={option.id}>
                                          {option.label}
                                        </SelectItem>
                                      ))}
                                  </SelectContent>
                                </Select>
                              )}

                              {field.conditional && "propertyField" in field.conditional && (
                                <Select
                                  value={field.conditional.propertyField}
                                  onValueChange={(value) =>
                                    updateField(sectionIndex, fieldIndex, {
                                      conditional: {
                                        propertyField: value,
                                        value: field.conditional?.value ?? true,
                                      },
                                    })
                                  }
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder="Property field" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {PROPERTY_CONDITION_FIELDS.map((propertyField) => (
                                      <SelectItem key={propertyField} value={propertyField}>
                                        {propertyField}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}

                              {field.conditional ? (
                                <Input
                                  value={String(field.conditional.value)}
                                  onChange={(e) =>
                                    updateField(sectionIndex, fieldIndex, {
                                      conditional: {
                                        ...field.conditional!,
                                        value: parseConditionValue(e.target.value),
                                      } as BuilderCondition,
                                    })
                                  }
                                  placeholder="Condition value (true, false, 2, etc)"
                                />
                              ) : (
                                <div />
                              )}
                            </div>
                          </div>
                        ))}
                        {section.fields.length === 0 && (
                          <p className="text-xs text-muted-foreground">No fields yet. Add one to this section.</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={addSection}>
                    <Plus className="mr-2 h-4 w-4" />
                    Add section
                  </Button>
                  <Button onClick={saveTemplate} disabled={saving}>
                    <Save className="mr-2 h-4 w-4" />
                    {saving ? "Saving..." : isEditing ? "Save changes" : "Create template"}
                  </Button>
                  {isEditing && (
                    <Button variant="outline" onClick={saveAsCopy} disabled={savingCopy}>
                      <Copy className="mr-2 h-4 w-4" />
                      {savingCopy ? "Copying..." : "Save as template copy"}
                    </Button>
                  )}
                  {isEditing && (
                    <Button
                      variant="destructive"
                      onClick={() => setDeleteOpen(true)}
                      disabled={deletingTemplate}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete template
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="submissions" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Submitted Forms</CardTitle>
              <Button variant="outline" size="sm" onClick={loadSubmissions}>
                <RefreshCcw className="mr-2 h-4 w-4" />
                Refresh
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {submissions.map((submission) => (
                  <div key={submission.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <p className="text-sm font-medium">
                        {submission.job?.property?.name} - {submission.template?.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {submission.template?.serviceType?.replace(/_/g, " ")} - Submitted by{" "}
                        {submission.submittedBy?.name ?? submission.submittedBy?.email}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(submission.createdAt), "dd MMM yyyy HH:mm")} - Media: {submission.media?.length ?? 0}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={submission.laundryReady ? "default" : "secondary"}>
                        Laundry {submission.laundryReady ? "Ready" : "Not ready"}
                      </Badge>
                      <Button size="sm" variant="outline" onClick={() => openSubmission(submission)}>
                        <FileText className="mr-1 h-4 w-4" />
                        View
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={generatingJobId === submission.jobId}
                        onClick={() => generateAndDownload(submission.jobId)}
                      >
                        <Download className="mr-1 h-4 w-4" />
                        {generatingJobId === submission.jobId ? "Generating..." : "PDF"}
                      </Button>
                    </div>
                  </div>
                ))}
                {submissions.length === 0 && (
                  <p className="py-10 text-center text-sm text-muted-foreground">No form submissions yet.</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={Boolean(viewSubmission)} onOpenChange={() => setViewSubmission(null)}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Submission Detail</DialogTitle>
          </DialogHeader>
          {viewSubmission && (
            <div className="space-y-4">
              <div className="text-sm">
                <p>
                  <strong>Property:</strong> {viewSubmission.job?.property?.name}
                </p>
                <p>
                  <strong>Template:</strong> {viewSubmission.template?.name}
                </p>
                <p>
                  <strong>Submitted:</strong> {format(new Date(viewSubmission.createdAt), "dd MMM yyyy HH:mm")}
                </p>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Submission Media (batch preview)</p>
                <MediaGallery
                  items={(viewSubmission.media ?? []).map((m: any) => ({
                    id: m.id,
                    url: m.url,
                    label: `${m.fieldId} (${m.mediaType})`,
                    mediaType: m.mediaType,
                  }))}
                  emptyText="No uploaded media"
                  title="Submission Media"
                />
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">Report Preview</p>
                <div className="h-[65vh] overflow-hidden rounded-md border">
                  <iframe
                    title="Report preview"
                    src={`/api/reports/${viewSubmission.jobId}/download?format=html`}
                    className="h-full w-full bg-white"
                  />
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <TwoStepConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete form template"
        description="This template will be deactivated and unavailable for future jobs."
        confirmLabel="Delete template"
        loading={deletingTemplate}
        onConfirm={deleteTemplate}
      />
    </div>
  );
}
