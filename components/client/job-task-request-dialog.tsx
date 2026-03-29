"use client";

import { useMemo, useState } from "react";
import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MediaGallery } from "@/components/shared/media-gallery";
import { toast } from "@/hooks/use-toast";

async function uploadTaskRequestFile(file: File) {
  const form = new FormData();
  form.append("file", file);
  form.append("folder", "client-job-task-requests");
  const response = await fetch("/api/uploads/direct", { method: "POST", body: form });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error ?? "Could not upload file.");
  }
  return {
    key: String(body.key),
    url: String(body.url),
    label: file.name,
  };
}

export function ClientJobTaskRequestDialog({
  jobId,
  jobLabel,
}: {
  jobId: string;
  jobLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [requiresPhoto, setRequiresPhoto] = useState(false);
  const [requiresNote, setRequiresNote] = useState(false);
  const [attachments, setAttachments] = useState<Array<{ key: string; url: string; label: string }>>([]);

  const mediaItems = useMemo(
    () =>
      attachments.map((item) => ({
        id: item.key,
        url: item.url,
        label: item.label,
        mediaType: "PHOTO" as const,
      })),
    [attachments]
  );

  async function handleAttachments(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      const uploaded: Array<{ key: string; url: string; label: string }> = [];
      for (const file of Array.from(files)) {
        uploaded.push(await uploadTaskRequestFile(file));
      }
      setAttachments((prev) => [...prev, ...uploaded]);
      toast({ title: `${uploaded.length} file(s) uploaded` });
    } catch (error: any) {
      toast({
        title: "Upload failed",
        description: error?.message ?? "Could not upload files.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    if (!title.trim()) {
      toast({ title: "Task title is required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`/api/client/jobs/${jobId}/task-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          requiresPhoto,
          requiresNote,
          attachmentKeys: attachments.map((item) => item.key),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error ?? "Could not submit task request.");
      }
      toast({
        title: "Task request submitted",
        description: "Admin review is required before the task is sent to cleaners.",
      });
      setTitle("");
      setDescription("");
      setRequiresPhoto(false);
      setRequiresNote(false);
      setAttachments([]);
      setOpen(false);
      router.refresh();
    } catch (error: any) {
      toast({
        title: "Request failed",
        description: error?.message ?? "Could not submit task request.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Request task
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Request special task</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{jobLabel}</p>
            <div className="space-y-1.5">
              <Label htmlFor={`task-title-${jobId}`}>Task title</Label>
              <Input id={`task-title-${jobId}`} value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`task-description-${jobId}`}>Instructions</Label>
              <Textarea
                id={`task-description-${jobId}`}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the request clearly for admin review and cleaners."
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <Checkbox checked={requiresPhoto} onCheckedChange={(checked) => setRequiresPhoto(checked === true)} />
                Require photo proof
              </label>
              <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <Checkbox checked={requiresNote} onCheckedChange={(checked) => setRequiresNote(checked === true)} />
                Require cleaner note
              </label>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`task-files-${jobId}`}>Reference files</Label>
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
                <Upload className="h-4 w-4" />
                <span>{uploading ? "Uploading..." : "Upload image or video references"}</span>
                <input
                  id={`task-files-${jobId}`}
                  type="file"
                  className="hidden"
                  accept="image/*,video/*"
                  multiple
                  onChange={(e) => handleAttachments(e.target.files)}
                />
              </label>
              {mediaItems.length > 0 ? <MediaGallery items={mediaItems} /> : null}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={saving || uploading}>
                {saving ? "Submitting..." : "Submit request"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
