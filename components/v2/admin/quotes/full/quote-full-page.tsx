"use client";

/**
 * Quote full page (board "Quote full page: detail and edit combined"). Holds
 * the saved quote, the dialogs and the server actions; the workspace below is
 * keyed by a revision that changes after every explicit reload, so it re-seeds
 * from what the server saved. A reload that is overtaken by a newer one is
 * ignored. Autosave does not re-key the workspace (the person may be typing):
 * it only keeps the saved record and the version token (`tokenRef`), which
 * every PATCH on this page sends as `expectedUpdatedAt`.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/hooks/use-toast";
import { snapshotFromRecord, type QuoteRecordInput, type QuoteSnapshot } from "@/lib/quotes/quote-record";
import { shortQuoteRef } from "@/lib/quotes/pipeline-types";
import { editSeedFromSnapshot } from "@/lib/quotes/quote-record";
import type { QuoteBuilderOptions } from "../builder/use-quote-builder";
import type { MarginModel } from "../builder/margin";
import { QuoteWorkspace } from "./quote-workspace";
import { useQuoteActions } from "./use-quote-actions";
import { DeleteQuoteDialog, EmailPreviewModal, PdfPreviewModal } from "./quote-dialogs";
import { ConvertDialog } from "./convert-dialog";

export type QuoteFullPageProps = {
  initial: QuoteSnapshot | null;
  builderOptions: Omit<QuoteBuilderOptions, "defaultRecipient" | "editQuote">;
  marginModel: MarginModel;
  timezone: string;
  fromCase: { caseId: string; caseTitle: string; href: string } | null;
  notices?: React.ReactNode;
};

export function QuoteFullPage({ initial, builderOptions, marginModel, timezone, fromCase, notices }: QuoteFullPageProps) {
  const router = useRouter();
  const [snapshot, setSnapshot] = React.useState<QuoteSnapshot | null>(initial);
  const [revision, setRevision] = React.useState(0);
  const [convertDate, setConvertDate] = React.useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const createdId = React.useRef<string | null>(null);
  const reloadSeq = React.useRef(0);
  const snapshotRef = React.useRef(snapshot);
  snapshotRef.current = snapshot;
  const tokenRef = React.useRef<string | null>(initial?.updatedAt ?? null);

  const reload = React.useCallback(async () => {
    const current = snapshotRef.current;
    if (!current) {
      if (createdId.current) router.push(`/v2/admin/quotes/${createdId.current}`);
      return;
    }
    const seq = ++reloadSeq.current;
    try {
      const res = await fetch(`/api/admin/quotes/${current.id}`, { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as (QuoteRecordInput & { error?: string }) | null;
      if (seq !== reloadSeq.current) return;
      if (!res.ok || !body) {
        toast({ title: "Saved, but the page could not refresh", description: body?.error ?? "Reload the page to see the latest version.", variant: "destructive" });
        return;
      }
      const next = snapshotFromRecord(body, { client: current.client, lead: current.lead });
      tokenRef.current = next.updatedAt;
      setSnapshot(next);
      setRevision((value) => value + 1);
    } catch {
      if (seq === reloadSeq.current) toast({ title: "Saved, but the page could not refresh", description: "Reload the page to see the latest version.", variant: "destructive" });
    }
  }, [router]);

  const actions = useQuoteActions(reload, tokenRef);

  /** An autosave landed: keep the stored record (same parties) without re-seeding the builder. */
  const onAutosaved = React.useCallback((record: Record<string, unknown>) => {
    setSnapshot((current) => {
      if (!current || record.id !== current.id) return current;
      return { ...snapshotFromRecord({ ...current, ...(record as Partial<QuoteRecordInput>), id: current.id, client: current.client, lead: current.lead }), updatedAt: tokenRef.current ?? current.updatedAt };
    });
  }, []);

  async function onCreated(quoteId: string, send: boolean, recipient: string | null) {
    createdId.current = quoteId;
    if (!send) {
      toast({ title: "Quote created", description: "Saved as a draft." });
      router.push(`/v2/admin/quotes/${quoteId}`);
      return;
    }
    const opened = await actions.openEmailPreview(quoteId, recipient, true);
    if (!opened) router.push(`/v2/admin/quotes/${quoteId}`);
  }

  function cancelEmail() {
    const preview = actions.emailPreview;
    actions.setEmailPreview(null);
    if (preview?.afterCreate) {
      toast({ title: "Saved as draft", description: "The quote was created but not sent." });
      router.push(`/v2/admin/quotes/${preview.quoteId}`);
    }
  }

  async function confirmDelete() {
    if (!snapshot) return;
    setDeleteError(null);
    const result = await actions.deleteQuote(snapshot.id);
    if (!result.ok) return setDeleteError(result.error);
    toast({ title: "Quote deleted" });
    router.push("/v2/admin/quotes");
  }

  const editQuote = snapshot ? editSeedFromSnapshot(snapshot) : undefined;

  return (
    <>
      <QuoteWorkspace
        key={`${snapshot?.id ?? "new"}:${revision}`}
        snapshot={snapshot}
        builderOptions={{ ...builderOptions, editQuote }}
        marginModel={marginModel}
        timezone={timezone}
        fromCase={fromCase}
        actions={actions}
        notices={notices}
        onReload={reload}
        tokenRef={tokenRef}
        onAutosaved={onAutosaved}
        onCreated={onCreated}
        onConvert={(date) => setConvertDate(date)}
        onDelete={() => {
          setDeleteError(null);
          setDeleteOpen(true);
        }}
      />
      <PdfPreviewModal url={actions.pdfUrl} onClose={actions.closePdf} />
      <EmailPreviewModal preview={actions.emailPreview} sending={actions.busy === "send"} onCancel={cancelEmail} onSend={() => void actions.confirmSend()} />
      {snapshot ? (
        <>
          <ConvertDialog
            key={`convert:${revision}`}
            open={convertDate !== null}
            initialDate={convertDate ?? ""}
            quote={{
              id: snapshot.id,
              clientId: snapshot.clientId,
              serviceType: snapshot.serviceType,
              frequency: snapshot.frequency,
              prefillAddress: (snapshot.serviceAddress ?? snapshot.client?.address ?? snapshot.lead?.address ?? "").trim(),
              prefillSuburb: (snapshot.serviceSuburb ?? snapshot.client?.suburb ?? snapshot.lead?.suburb ?? "").trim(),
            }}
            onClose={() => setConvertDate(null)}
            onDone={async (jobId) => {
              setConvertDate(null);
              toast({ title: jobId ? "Quote converted to job" : "Quote marked converted. Schedule the visit when ready." });
              if (jobId) router.push(`/v2/admin/jobs/${jobId}`);
              else await reload();
            }}
          />
          <DeleteQuoteDialog open={deleteOpen} reference={shortQuoteRef(snapshot)} busy={actions.busy === "delete"} error={deleteError} onClose={() => setDeleteOpen(false)} onConfirm={() => void confirmDelete()} />
        </>
      ) : null}
    </>
  );
}
