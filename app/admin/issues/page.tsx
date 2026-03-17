"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RefreshCcw } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { MediaGallery, type MediaGalleryItem } from "@/components/shared/media-gallery";

const STATUS_COLORS: Record<string, any> = {
  OPEN: "destructive",
  IN_PROGRESS: "warning",
  RESOLVED: "success",
};

type AssigneeOption = {
  id: string;
  name: string | null;
  email: string;
  role: string;
};

type IssueUpdate = {
  atLabel: string;
  actorLabel: string;
  note: string;
};

type IssueItem = {
  id: string;
  title: string;
  descriptionText: string;
  summary: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED";
  caseType: "LOST_FOUND" | "DAMAGE" | "SLA" | "OTHER";
  createdAt: string;
  updatedAt: string;
  ageHours: number;
  overdue: boolean;
  evidenceKeys: string[];
  updates: IssueUpdate[];
  meta: {
    assigneeUserId: string | null;
    dueAt: string | null;
    tags: string[];
  };
  assignee: AssigneeOption | null;
  job?: {
    id: string;
    status: string;
    property?: {
      id: string;
      name: string;
      suburb: string | null;
    } | null;
  } | null;
};

function toDateTimeLocalValue(isoValue: string | null | undefined) {
  if (!isoValue) return "";
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMinutes = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offsetMinutes * 60_000);
  return local.toISOString().slice(0, 16);
}

function localDateTimeToIso(value: string) {
  if (!value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export default function AdminIssuesPage() {
  const [items, setItems] = useState<IssueItem[]>([]);
  const [assignees, setAssignees] = useState<AssigneeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [severityFilter, setSeverityFilter] = useState("ALL");
  const [scopeFilter, setScopeFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("ALL");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<IssueItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [editStatus, setEditStatus] = useState("OPEN");
  const [editSeverity, setEditSeverity] = useState("MEDIUM");
  const [editAssigneeUserId, setEditAssigneeUserId] = useState("__unassigned");
  const [editDueAt, setEditDueAt] = useState("");
  const [editTagsText, setEditTagsText] = useState("");
  const [resolutionNote, setResolutionNote] = useState("");
  const [loadingEvidence, setLoadingEvidence] = useState(false);
  const [evidenceItems, setEvidenceItems] = useState<MediaGalleryItem[]>([]);

  async function load() {
    setLoading(true);
    const query = new URLSearchParams();
    query.set("scope", scopeFilter);
    if (statusFilter !== "ALL") query.set("status", statusFilter);
    if (severityFilter !== "ALL") query.set("severity", severityFilter);
    if (assigneeFilter !== "ALL") query.set("assigneeUserId", assigneeFilter);
    if (overdueOnly) query.set("overdueOnly", "true");
    if (search.trim()) query.set("q", search.trim());
    const res = await fetch(`/api/admin/issues?${query.toString()}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setItems([]);
      setAssignees([]);
      toast({ title: "Load failed", description: body?.error ?? "Could not load cases.", variant: "destructive" });
      setLoading(false);
      return;
    }
    setItems(Array.isArray(body?.items) ? body.items : []);
    setAssignees(Array.isArray(body?.assignees) ? body.assignees : []);
    setLoading(false);
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      load();
    }, 200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, scopeFilter, severityFilter, assigneeFilter, overdueOnly, search]);

  useEffect(() => {
    if (!selected) return;
    setEditStatus(selected.status ?? "OPEN");
    setEditSeverity(selected.severity ?? "MEDIUM");
    setEditAssigneeUserId(selected.meta?.assigneeUserId ?? "__unassigned");
    setEditDueAt(toDateTimeLocalValue(selected.meta?.dueAt));
    setEditTagsText(Array.isArray(selected.meta?.tags) ? selected.meta.tags.join(", ") : "");
    setResolutionNote("");
    loadEvidence(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  async function loadEvidence(item: IssueItem) {
    const keys = Array.isArray(item.evidenceKeys) ? item.evidenceKeys : [];
    if (keys.length === 0) {
      setEvidenceItems([]);
      return;
    }
    setLoadingEvidence(true);
    try {
      const previews = await Promise.all(
        keys.map(async (key) => {
          const url = `/api/uploads/access?key=${encodeURIComponent(key)}&jobId=${encodeURIComponent(item.job?.id ?? "")}`;
          const res = await fetch(url, { cache: "no-store" });
          const body = await res.json().catch(() => ({}));
          if (!res.ok || !body?.url) return null;
          return {
            id: key,
            url: String(body.url),
            label: key.split("/").pop() || "Case evidence",
            mediaType: "PHOTO",
          } as MediaGalleryItem;
        })
      );
      setEvidenceItems(previews.filter((entry): entry is MediaGalleryItem => Boolean(entry)));
    } catch {
      setEvidenceItems([]);
      toast({
        title: "Evidence preview failed",
        description: "Could not load one or more image previews.",
        variant: "destructive",
      });
    } finally {
      setLoadingEvidence(false);
    }
  }

  async function saveCase() {
    if (!selected) return;
    const tags = editTagsText
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    setSaving(true);
    const res = await fetch(`/api/admin/issues/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: editStatus,
        severity: editSeverity,
        assigneeUserId: editAssigneeUserId === "__unassigned" ? null : editAssigneeUserId,
        dueAt: localDateTimeToIso(editDueAt),
        tags,
        resolutionNote: resolutionNote || undefined,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      toast({ title: "Update failed", description: body.error ?? "Could not update case.", variant: "destructive" });
      return;
    }
    toast({ title: "Case updated" });
    setSelected(null);
    load();
  }

  const openCount = useMemo(() => items.filter((item) => item.status !== "RESOLVED").length, [items]);
  const overdueCount = useMemo(() => items.filter((item) => item.overdue).length, [items]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-2xl font-bold">Cases</h2>
          <p className="text-sm text-muted-foreground">
            Open: {openCount} | Overdue: {overdueCount}
          </p>
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="Search case title/details..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64"
          />
          <Select value={scopeFilter} onValueChange={setScopeFilter}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Issues</SelectItem>
              <SelectItem value="damage">Damage Cases</SelectItem>
              <SelectItem value="lost-found">Lost & Found</SelectItem>
              <SelectItem value="sla">SLA Breaches</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All severity</SelectItem>
              <SelectItem value="LOW">LOW</SelectItem>
              <SelectItem value="MEDIUM">MEDIUM</SelectItem>
              <SelectItem value="HIGH">HIGH</SelectItem>
              <SelectItem value="CRITICAL">CRITICAL</SelectItem>
            </SelectContent>
          </Select>
          <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
            <SelectTrigger className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All owners</SelectItem>
              <SelectItem value="__unassigned">Unassigned</SelectItem>
              {assignees.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {(user.name || user.email).trim()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              <SelectItem value="OPEN">Open</SelectItem>
              <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
              <SelectItem value="RESOLVED">Resolved</SelectItem>
            </SelectContent>
          </Select>
          <Button variant={overdueOnly ? "default" : "outline"} onClick={() => setOverdueOnly((value) => !value)}>
            {overdueOnly ? "Overdue only" : "Show overdue"}
          </Button>
          <Button variant="outline" onClick={load}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Loading cases...</p>
          ) : items.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No cases found.</p>
          ) : (
            <div className="divide-y">
              {items.map((item) => (
                <button
                  key={item.id}
                  className="w-full px-6 py-3 text-left hover:bg-muted/30"
                  onClick={() => setSelected(item)}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{item.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.job?.property?.name} {item.job?.property?.suburb ? `(${item.job.property.suburb})` : ""} |{" "}
                        {new Date(item.createdAt).toLocaleString("en-AU")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Owner: {item.assignee?.name ?? item.assignee?.email ?? "Unassigned"} | Age: {item.ageHours}h
                        {item.overdue ? " | OVERDUE" : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{item.caseType.replace(/_/g, " ")}</Badge>
                      <Badge variant="outline">{item.severity}</Badge>
                      <Badge variant={STATUS_COLORS[item.status] ?? "secondary"}>{item.status}</Badge>
                    </div>
                  </div>
                  {Array.isArray(item.meta?.tags) && item.meta.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {item.meta.tags.map((tag) => (
                        <Badge key={`${item.id}-${tag}`} variant="outline" className="text-[11px]">
                          #{tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Case Detail</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium">{selected.title}</p>
                <p className="text-xs text-muted-foreground">
                  {selected.job?.property?.name} | {new Date(selected.createdAt).toLocaleString("en-AU")}
                </p>
                {selected.job?.id ? (
                  <div className="mt-2">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/admin/jobs/${selected.job.id}`}>Open linked job</Link>
                    </Button>
                  </div>
                ) : null}
              </div>

              <div className="rounded-md border bg-muted/20 p-3 text-sm whitespace-pre-wrap">
                {selected.descriptionText || "No details provided."}
              </div>

              <div className="space-y-1.5">
                <Label>Evidence</Label>
                {loadingEvidence ? (
                  <p className="text-xs text-muted-foreground">Loading evidence preview...</p>
                ) : evidenceItems.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No evidence uploads on this case.</p>
                ) : (
                  <MediaGallery items={evidenceItems} title="Case evidence preview" />
                )}
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>Status</Label>
                  <Select value={editStatus} onValueChange={setEditStatus}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="OPEN">OPEN</SelectItem>
                      <SelectItem value="IN_PROGRESS">IN PROGRESS</SelectItem>
                      <SelectItem value="RESOLVED">RESOLVED</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Severity</Label>
                  <Select value={editSeverity} onValueChange={setEditSeverity}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LOW">LOW</SelectItem>
                      <SelectItem value="MEDIUM">MEDIUM</SelectItem>
                      <SelectItem value="HIGH">HIGH</SelectItem>
                      <SelectItem value="CRITICAL">CRITICAL</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Owner</Label>
                  <Select value={editAssigneeUserId} onValueChange={setEditAssigneeUserId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__unassigned">Unassigned</SelectItem>
                      {assignees.map((user) => (
                        <SelectItem key={user.id} value={user.id}>
                          {user.name || user.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Due at (SLA target)</Label>
                  <Input type="datetime-local" value={editDueAt} onChange={(e) => setEditDueAt(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Tags (comma separated)</Label>
                  <Input
                    placeholder="urgent, client-followup, safety"
                    value={editTagsText}
                    onChange={(e) => setEditTagsText(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Resolution / update note</Label>
                <Textarea
                  placeholder="Add note about next action, client handover, pickup details, or closure."
                  value={resolutionNote}
                  onChange={(e) => setResolutionNote(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Case activity</Label>
                {selected.updates.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No timeline notes yet.</p>
                ) : (
                  <div className="space-y-2 rounded-md border p-3">
                    {selected.updates.map((update, index) => (
                      <div key={`${selected.id}-u-${index}`} className="rounded border bg-muted/20 p-2">
                        <p className="text-xs font-medium">
                          {update.atLabel} - {update.actorLabel}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{update.note}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setSelected(null)} disabled={saving}>
                  Close
                </Button>
                <Button onClick={saveCase} disabled={saving}>
                  {saving ? "Saving..." : "Save case"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
