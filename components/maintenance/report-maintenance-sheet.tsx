"use client";

import * as React from "react";
import { useSession } from "next-auth/react";
import { Wrench } from "lucide-react";
import {
  MaintenanceAction,
  MaintenanceCategory,
  MaintenancePriority,
} from "@prisma/client";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UploadDropzone } from "@/components/ui/upload-dropzone";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/hooks/use-toast";
import {
  ACTION_LABELS,
  CATEGORY_LABELS,
  PRIORITY_LABELS,
} from "@/lib/maintenance/labels";

const CATEGORIES = Object.values(MaintenanceCategory);
const ACTIONS = Object.values(MaintenanceAction);
const PRIORITIES = Object.values(MaintenancePriority);

export interface ReportMaintenanceSheetProps {
  /** Airbnb property to attach the item to. */
  propertyId: string;
  /** Optional job context (cleaner/QA flows). */
  jobId?: string;
  /** Button styling/label overrides for the trigger. */
  triggerLabel?: string;
  triggerVariant?: "default" | "outline" | "secondary" | "ghost";
  triggerSize?: "default" | "sm" | "lg" | "icon";
  triggerClassName?: string;
  /** Fired after a successful report (parent may refresh a list). */
  onReported?: () => void;
}

/**
 * Self-contained "Report something to fix / replace" sheet. Reusable across the
 * cleaner job flow, QA inspection, and the client portal. Posts to
 * /api/maintenance; the server enforces role + Airbnb gating.
 */
export function ReportMaintenanceSheet({
  propertyId,
  jobId,
  triggerLabel = "Report something to fix / replace",
  triggerVariant = "outline",
  triggerSize = "sm",
  triggerClassName,
  onReported,
}: ReportMaintenanceSheetProps) {
  const { data: authSession } = useSession();
  const [open, setOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  const [category, setCategory] = React.useState<MaintenanceCategory>("OTHER");
  const [area, setArea] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [recommendedAction, setRecommendedAction] = React.useState<MaintenanceAction>("REPLACE");
  const [priority, setPriority] = React.useState<MaintenancePriority>("MEDIUM");
  const [photoKeys, setPhotoKeys] = React.useState<string[]>([]);

  function reset() {
    setCategory("OTHER");
    setArea("");
    setTitle("");
    setDescription("");
    setRecommendedAction("REPLACE");
    setPriority("MEDIUM");
    setPhotoKeys([]);
  }

  async function submit() {
    if (!title.trim()) {
      toast({ title: "Add a short title", description: "Describe the item in a few words.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId,
          jobId: jobId ?? undefined,
          category,
          area: area.trim() || undefined,
          title: title.trim(),
          description: description.trim() || undefined,
          recommendedAction,
          priority,
          photoKeys: photoKeys.length > 0 ? photoKeys : undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Could not submit", description: body.error ?? "Please retry.", variant: "destructive" });
        return;
      }
      toast({ title: "Reported", description: "Thanks — this has been added to the maintenance tracker." });
      reset();
      setOpen(false);
      onReported?.();
    } catch {
      toast({ title: "Could not submit", description: "Network error. Please retry.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Drawer open={open} onOpenChange={(next) => { setOpen(next); if (!next) setSubmitting(false); }}>
      <DrawerTrigger asChild>
        <Button type="button" variant={triggerVariant} size={triggerSize} className={triggerClassName}>
          <Wrench className="mr-2 h-4 w-4" />
          {triggerLabel}
        </Button>
      </DrawerTrigger>
      <DrawerContent side="right" className="flex w-full max-w-md flex-col p-0">
        <DrawerHeader className="border-b border-border p-6 pb-4">
          <DrawerTitle>Report something to fix or replace</DrawerTitle>
          <DrawerDescription>
            Old, worn, broken, or outdated items that hurt the guest experience. The team tracks these to resolution.
          </DrawerDescription>
        </DrawerHeader>

        <ScrollArea className="flex-1">
          <div className="space-y-4 p-6">
            <div className="space-y-1.5">
              <Label htmlFor="maint-title">What needs attention?</Label>
              <Input
                id="maint-title"
                value={title}
                maxLength={180}
                placeholder="e.g. Cracked bedside lamp"
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={category} onValueChange={(v) => setCategory(v as MaintenanceCategory)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>{CATEGORY_LABELS[c]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="maint-area">Area / room</Label>
                <Input
                  id="maint-area"
                  value={area}
                  maxLength={120}
                  placeholder="e.g. Master bedroom"
                  onChange={(e) => setArea(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Recommended action</Label>
                <Select value={recommendedAction} onValueChange={(v) => setRecommendedAction(v as MaintenanceAction)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ACTIONS.map((a) => (
                      <SelectItem key={a} value={a}>{ACTION_LABELS[a]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Select value={priority} onValueChange={(v) => setPriority(v as MaintenancePriority)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>{PRIORITY_LABELS[p]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="maint-desc">Details (optional)</Label>
              <Textarea
                id="maint-desc"
                value={description}
                rows={4}
                maxLength={6000}
                placeholder="What's wrong, how bad, anything the team should know."
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Photos (optional)</Label>
              <UploadDropzone
                accept="image/*"
                jobId={jobId}
                stamp={{ capturerName: authSession?.user?.name ?? "Reporter" }}
                onUploaded={(r) => setPhotoKeys((prev) => [...prev, r.key])}
                onFailure={(name) =>
                  toast({ title: "Upload failed", description: `${name} could not be uploaded.`, variant: "destructive" })
                }
              />
              {photoKeys.length > 0 ? (
                <p className="text-xs text-muted-foreground">{photoKeys.length} photo(s) attached.</p>
              ) : null}
            </div>
          </div>
        </ScrollArea>

        <div className="flex items-center justify-end gap-2 border-t border-border p-4">
          <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={submitting}>
            {submitting ? "Submitting…" : "Submit report"}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
