"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { PackageSearch, RefreshCw, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import {
  LOST_FOUND_STATUS_LABELS,
  LOST_FOUND_EVENT_LABELS,
  type LostFoundStatus,
} from "@/lib/lost-found/status";

interface JobOption {
  id: string;
  label: string;
}

type ItemRow = {
  id: string;
  itemName: string;
  foundLocation: string | null;
  status: LostFoundStatus;
  propertyName: string | null;
  createdAt: string;
};

type TimelineEvent = {
  id: string;
  action: string;
  note: string | null;
  actorName: string | null;
  createdAt: string;
};

type ItemDetail = ItemRow & {
  description: string | null;
  events: TimelineEvent[];
};

function fmt(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
}

export function CleanerLostFoundPage({ jobs }: { jobs: JobOption[] }) {
  const [jobId, setJobId] = useState<string>(jobs[0]?.id ?? "");
  const [itemName, setItemName] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const [items, setItems] = useState<ItemRow[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [posting, setPosting] = useState(false);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await fetch("/api/cleaner/lost-found", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not load items.");
      setItems(Array.isArray(body.items) ? body.items : []);
    } catch (e: any) {
      toast({ title: "Could not load", description: e?.message, variant: "destructive" });
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  async function submitLostFound() {
    if (!jobId || !itemName.trim()) {
      toast({ title: "Add a job and item name", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/cleaner/lost-found", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          itemName: itemName.trim(),
          location: location.trim() || null,
          notes: notes.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed.");
      setItemName("");
      setLocation("");
      setNotes("");
      toast({
        title: "Item reported",
        description: body.notificationWarning ?? "Recorded and admin has been notified.",
      });
      await loadList();
    } catch (e: any) {
      toast({ title: "Could not submit", description: e?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function openDetail(id: string) {
    setDetailOpen(true);
    setDetail(null);
    setComment("");
    try {
      const res = await fetch(`/api/lost-found/${id}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not load item.");
      setDetail(body);
    } catch (e: any) {
      toast({ title: "Could not load item", description: e?.message, variant: "destructive" });
      setDetailOpen(false);
    }
  }

  async function postComment() {
    if (!detail || !comment.trim()) {
      toast({ title: "Write a comment first", variant: "destructive" });
      return;
    }
    setPosting(true);
    try {
      const res = await fetch(`/api/lost-found/${detail.id}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "COMMENT", note: comment.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not comment.");
      setDetail(body);
      setComment("");
      toast({ title: "Comment added" });
    } catch (e: any) {
      toast({ title: "Comment failed", description: e?.message, variant: "destructive" });
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={<>Lost &amp; Found</>}
        description="Report an item found during a job, then follow it through to return."
        icon={<PackageSearch />}
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Report a found item</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">Job</Label>
            <Select value={jobId} onValueChange={setJobId}>
              <SelectTrigger>
                <SelectValue placeholder="Select job" />
              </SelectTrigger>
              <SelectContent>
                {jobs.map((job) => (
                  <SelectItem key={job.id} value={job.id}>
                    {job.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Item name</Label>
            <Input placeholder="Item name" value={itemName} onChange={(e) => setItemName(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Where found</Label>
            <Input placeholder="Where found" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Notes</Label>
            <Textarea placeholder="Notes for admin/client" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <Button onClick={submitLostFound} disabled={saving || !jobs.length} className="w-full">
            {saving ? "Submitting..." : "Report found item"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">My reported items</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => void loadList()} disabled={loadingList}>
            <RefreshCw className={loadingList ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {loadingList ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : items.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No items reported yet.</p>
          ) : (
            items.map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => void openDetail(it.id)}
                className="flex w-full items-center justify-between gap-3 rounded-md border p-3 text-left hover:bg-muted/50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{it.itemName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[it.foundLocation, it.propertyName].filter(Boolean).join(" · ") || "—"} · {fmt(it.createdAt)}
                  </p>
                </div>
                <Badge variant="secondary">{LOST_FOUND_STATUS_LABELS[it.status]}</Badge>
              </button>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{detail?.itemName ?? "Item"}</DialogTitle>
          </DialogHeader>
          {!detail ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{LOST_FOUND_STATUS_LABELS[detail.status]}</Badge>
                <span className="text-xs text-muted-foreground">
                  {[detail.foundLocation, detail.propertyName].filter(Boolean).join(" · ")}
                </span>
              </div>
              {detail.description ? (
                <p className="whitespace-pre-wrap text-sm">{detail.description}</p>
              ) : null}

              <div className="space-y-2 rounded-md border p-3">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <MessageSquare className="h-4 w-4" /> Timeline
                </p>
                <div className="max-h-64 space-y-2 overflow-y-auto">
                  {detail.events.map((ev) => (
                    <div key={ev.id} className="rounded border bg-muted/30 p-2">
                      <p className="text-xs font-medium">
                        {LOST_FOUND_EVENT_LABELS[ev.action] ?? ev.action}
                        <span className="ml-1 font-normal text-muted-foreground">
                          · {ev.actorName ?? "System"} · {fmt(ev.createdAt)}
                        </span>
                      </p>
                      {ev.note ? <p className="mt-1 whitespace-pre-wrap text-sm">{ev.note}</p> : null}
                    </div>
                  ))}
                </div>
                <Textarea
                  placeholder="Add a comment for the office"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
                <div className="flex justify-end">
                  <Button size="sm" onClick={() => void postComment()} disabled={posting}>
                    {posting ? "Posting…" : "Add comment"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
