"use client";

/**
 * Registering the NFC tags stuck up at a property.
 *
 * THREE WAYS IN, because the admin doing this could be on any device:
 *
 *   1. GENERATE — name it, we mint the token, and the URL to write appears.
 *      On an Android phone in Chrome, "Write to tag" programs a blank tag
 *      directly from this page via Web NFC. On anything else, copy the URL
 *      into any NFC writer app (NFC Tools and friends all take a URL record).
 *   2. SCAN — on Android, tap a tag that already exists and its serial is
 *      captured, for tags bought pre-programmed or already on a wall.
 *   3. QR — every tag also renders a QR of the same URL. Print it beside the
 *      tag and a phone with no NFC, or a tag that has died, still works. It
 *      costs nothing and removes a whole category of "I couldn't check in".
 *
 * Web NFC exists only in Chrome on Android. That is not a gap to apologise for
 * — it is why the tag holds a URL in the first place, so the READING side works
 * everywhere including iPhones. Only the WRITING convenience is Android-only,
 * and routes 1-via-app and 3 cover everyone else.
 */

import * as React from "react";
import QRCode from "qrcode";
import { Nfc, Plus, QrCode, Trash2, Copy, Check } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  EBadge,
  EButton,
  ECard,
  ECardBody,
  ECardHeader,
  ECardTitle,
  EEmptyState,
} from "@/components/v2/ui/primitives";
import { EConfirmButton, EField, EInput, EModal, ESwitch } from "@/components/v2/admin/estate-kit";

interface NfcTag {
  id: string;
  label: string;
  tagUid: string | null;
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  url: string;
}

/** Chrome-on-Android only; every other browser leaves this undefined. */
function webNfcSupported(): boolean {
  return typeof window !== "undefined" && "NDEFReader" in window;
}

export function NfcTagsCard({ propertyId }: { propertyId: string }) {
  const [tags, setTags] = React.useState<NfcTag[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [adding, setAdding] = React.useState(false);
  const [label, setLabel] = React.useState("");
  const [scannedUid, setScannedUid] = React.useState<string | null>(null);
  const [scanning, setScanning] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [qrTag, setQrTag] = React.useState<NfcTag | null>(null);
  const [qrDataUrl, setQrDataUrl] = React.useState<string | null>(null);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const [requireTag, setRequireTag] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/properties/${propertyId}/nfc-tags`);
      const body = await res.json();
      if (res.ok) {
        setTags(body.tags ?? []);
        setRequireTag(body.requireNfcCheckIn === true);
      }
    } catch {
      // A failed list must not take the property page down with it.
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (!qrTag) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(qrTag.url, { width: 320, margin: 1 })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [qrTag]);

  async function scanForUid() {
    if (!webNfcSupported()) {
      toast({
        title: "Scanning needs Chrome on Android",
        description: "On any other device, add the tag by name and write the URL with an NFC app.",
      });
      return;
    }
    setScanning(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reader = new (window as any).NDEFReader();
      await reader.scan();
      const serial: string = await new Promise((resolve, reject) => {
        // A tag that is never presented would otherwise leave the admin
        // watching a spinner with no way to tell whether it is broken.
        const timer = setTimeout(() => reject(new Error("TIMEOUT")), 20_000);
        reader.onreading = (event: { serialNumber?: string }) => {
          clearTimeout(timer);
          resolve(event.serialNumber ?? "");
        };
        reader.onreadingerror = () => {
          clearTimeout(timer);
          reject(new Error("READ_FAILED"));
        };
      });
      if (!serial) {
        toast({ title: "That tag has no readable serial", description: "Add it by name instead." });
        return;
      }
      setScannedUid(serial);
      toast({ title: "Tag read", description: serial });
    } catch (err: any) {
      toast({
        title: err?.message === "TIMEOUT" ? "No tag detected" : "Could not read the tag",
        description: "Hold the tag flat against the back of the phone and try again.",
      });
    } finally {
      setScanning(false);
    }
  }

  async function writeToTag(tag: NfcTag) {
    if (!webNfcSupported()) {
      toast({
        title: "Writing needs Chrome on Android",
        description: "Copy the URL and write it with an NFC app such as NFC Tools.",
      });
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const writer = new (window as any).NDEFReader();
      // A URL record specifically — this is what makes an iPhone offer to open
      // it from the lock screen. Any other record type reads as nothing there.
      await writer.write({ records: [{ recordType: "url", data: tag.url }] });
      toast({ title: "Written", description: `${tag.label} is ready to use.` });
    } catch {
      toast({
        title: "Could not write to the tag",
        description: "Hold it against the phone until the write finishes, then try again.",
      });
    }
  }

  async function createTag() {
    if (!label.trim()) {
      toast({ title: "Name the tag", description: "For example: Front door." });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/properties/${propertyId}/nfc-tags`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label: label.trim(),
          ...(scannedUid ? { tagUid: scannedUid } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not create the tag.");
      setTags((prev) => [...prev, body.tag]);
      setLabel("");
      setScannedUid(null);
      setAdding(false);
      // Straight to the QR/URL, because a tag that has not been written onto a
      // physical chip yet is not finished.
      setQrTag(body.tag);
    } catch (err: any) {
      toast({ title: "Could not add the tag", description: err?.message });
    } finally {
      setBusy(false);
    }
  }

  async function setActive(tag: NfcTag, isActive: boolean) {
    const res = await fetch(`/api/admin/properties/${propertyId}/nfc-tags/${tag.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isActive }),
    });
    if (res.ok) {
      setTags((prev) => prev.map((t) => (t.id === tag.id ? { ...t, isActive } : t)));
    } else {
      toast({ title: "Could not update the tag" });
    }
  }

  async function removeTag(tag: NfcTag) {
    const res = await fetch(`/api/admin/properties/${propertyId}/nfc-tags/${tag.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setTags((prev) => prev.filter((t) => t.id !== tag.id));
    } else {
      toast({ title: "Could not remove the tag" });
    }
  }

  async function setEnforcement(next: boolean) {
    // Optimistic, then corrected — the server refuses to switch this on for a
    // property with no active tag, and that refusal is the whole point of the
    // check, so it must be allowed to win.
    setRequireTag(next);
    const res = await fetch(`/api/admin/properties/${propertyId}/nfc-tags`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requireNfcCheckIn: next }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setRequireTag(!next);
      toast({ title: "Could not change that", description: body?.error });
    }
  }

  async function copyUrl(tag: NfcTag) {
    try {
      await navigator.clipboard.writeText(tag.url);
      setCopiedId(tag.id);
      setTimeout(() => setCopiedId((id) => (id === tag.id ? null : id)), 2000);
    } catch {
      toast({ title: "Could not copy", description: tag.url });
    }
  }

  return (
    <ECard>
      <ECardHeader className="flex-row items-center justify-between pb-2">
        <ECardTitle className="text-[0.95rem]">NFC check-in tags</ECardTitle>
        <EButton variant="outline" size="sm" onClick={() => setAdding(true)}>
          <Plus className="h-3.5 w-3.5" /> Add tag
        </EButton>
      </ECardHeader>
      <ECardBody className="pt-0">
        {loading ? (
          <p className="text-[0.8125rem] text-[hsl(var(--e-muted-foreground))]">Loading…</p>
        ) : tags.length === 0 ? (
          <EEmptyState
            title="No tags here yet"
            description="Stick a tag by the door and register it. Cleaners tap it to check in without hunting for a GPS fix."
          />
        ) : (
          <div className="space-y-2">
            {tags.map((tag) => (
              <div
                key={tag.id}
                className="flex flex-wrap items-center gap-2 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface-raised))] px-3 py-2.5"
              >
                <Nfc className="h-4 w-4 shrink-0 text-[hsl(var(--e-primary))]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.875rem] font-[550]">{tag.label}</p>
                  <p className="truncate text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                    {tag.lastUsedAt
                      ? `Last tapped ${new Date(tag.lastUsedAt).toLocaleDateString("en-AU", {
                          day: "numeric",
                          month: "short",
                        })}`
                      : "Never tapped"}
                    {tag.tagUid ? ` · ${tag.tagUid}` : ""}
                  </p>
                </div>
                {!tag.isActive ? <EBadge tone="neutral">Retired</EBadge> : null}
                <div className="flex shrink-0 items-center gap-1">
                  <EButton variant="ghost" size="sm" onClick={() => copyUrl(tag)}>
                    {copiedId === tag.id ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </EButton>
                  <EButton variant="ghost" size="sm" onClick={() => setQrTag(tag)}>
                    <QrCode className="h-3.5 w-3.5" />
                  </EButton>
                  <EButton variant="ghost" size="sm" onClick={() => setActive(tag, !tag.isActive)}>
                    {tag.isActive ? "Retire" : "Restore"}
                  </EButton>
                  <EConfirmButton
                    ariaLabel={`Remove ${tag.label}`}
                    confirmLabel="Remove?"
                    onConfirm={() => removeTag(tag)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </EConfirmButton>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
          <div className="min-w-0">
            <p className="text-[0.8125rem] font-[550]">Require a tag to clock in</p>
            <p className="text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              Cleaners at this property can only start a job by tapping a tag. Turn this on
              once the tags are physically up — with it on and no tag on the wall, nobody
              can start.
            </p>
          </div>
          <ESwitch
            checked={requireTag}
            onCheckedChange={(v) => void setEnforcement(v)}
            label={requireTag ? "Tag only" : "Tag optional"}
          />
        </div>
      </ECardBody>

      <EModal open={adding} onClose={() => setAdding(false)} title="Add an NFC tag">
        <div className="space-y-4">
          <EField label="Where is it?" hint="What the cleaner will see. For example: Front door.">
            <EInput
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Front door"
            />
          </EField>

          <div className="rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] p-3">
            <p className="text-[0.8125rem] font-[550]">Already have a tag in your hand?</p>
            <p className="mt-1 text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
              On an Android phone you can tap it now to record its serial. Otherwise just name it —
              you will get a URL and a QR code to write onto a blank tag.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <EButton variant="outline" size="sm" onClick={scanForUid} disabled={scanning}>
                <Nfc className="h-3.5 w-3.5" /> {scanning ? "Hold tag to phone…" : "Scan a tag"}
              </EButton>
              {scannedUid ? (
                <span className="text-[0.75rem] text-[hsl(var(--e-success))]">Read {scannedUid}</span>
              ) : null}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <EButton variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </EButton>
            <EButton variant="gold" onClick={createTag} disabled={busy}>
              {busy ? "Adding…" : "Add tag"}
            </EButton>
          </div>
        </div>
      </EModal>

      <EModal open={Boolean(qrTag)} onClose={() => setQrTag(null)} title={qrTag?.label ?? "Tag"}>
        {qrTag ? (
          <div className="space-y-4">
            <p className="text-[0.8125rem] text-[hsl(var(--e-text-secondary))]">
              Write this URL onto the tag. On an Android phone, use the button below. On anything
              else, copy it into an NFC writer app and save it as a <strong>URL</strong> record.
            </p>

            <div className="break-all rounded-[var(--e-radius)] border border-[hsl(var(--e-border))] bg-[hsl(var(--e-surface))] px-3 py-2 text-[0.75rem]">
              {qrTag.url}
            </div>

            <div className="flex flex-wrap gap-2">
              <EButton variant="outline" size="sm" onClick={() => copyUrl(qrTag)}>
                <Copy className="h-3.5 w-3.5" /> Copy URL
              </EButton>
              <EButton variant="gold" size="sm" onClick={() => writeToTag(qrTag)}>
                <Nfc className="h-3.5 w-3.5" /> Write to tag
              </EButton>
            </div>

            {qrDataUrl ? (
              <div className="flex flex-col items-center gap-2 border-t border-[hsl(var(--e-border))] pt-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrDataUrl} alt={`QR code for ${qrTag.label}`} className="h-56 w-56" />
                <p className="text-center text-[0.75rem] text-[hsl(var(--e-muted-foreground))]">
                  Print this and put it beside the tag. It checks a cleaner in exactly the same way,
                  so a dead tag or a phone without NFC is never a blocked start.
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </EModal>
    </ECard>
  );
}
