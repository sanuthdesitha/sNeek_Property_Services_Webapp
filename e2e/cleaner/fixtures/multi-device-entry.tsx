import React from "react";
import { createRoot } from "react-dom/client";
import { BulkPhotoAssign } from "@/components/v2/cleaner/bulk-photo-assign";
import { EvidenceContext } from "@/components/v2/cleaner/evidence-context";
import { useSharedEvidenceSync } from "@/hooks/use-shared-evidence-sync";
import type { CapturedMedia } from "@/components/v2/cleaner/media-capture";
import type { UploadMap } from "@/components/v2/cleaner/form-renderer";
function Fixture() {
  const [pool, setPool] = React.useState<CapturedMedia[]>([]);
  const [uploads, setUploads] = React.useState<UploadMap>({});
  const [note, setNote] = React.useState("Local note");
  const error = useSharedEvidenceSync({
    jobId: "job",
    draftIdentity: "actor",
    canSync: () => true,
    readState: () => ({
      bulkPool: pool,
      uploads,
      answers: { note },
      updatedAt: new Date().toISOString(),
    }),
    restore: (state) => {
      setPool(state.bulkPool as CapturedMedia[]);
      setUploads(state.uploads as UploadMap);
      setNote((state.answers as { note: string }).note);
    },
  });
  return (
    <div data-skin="estate" data-portal-accent="cleaner">
      {error ? <p>Sync unavailable</p> : null}
      <output aria-label="Local note">{note}</output>
      <EvidenceContext.Provider
        value={{
          jobId: "job",
          templateId: "template",
          formRevision: "revision",
          draftIdentity: "actor",
        }}
      >
        <BulkPhotoAssign
          open
          onClose={() => {}}
          pool={pool}
          setPool={setPool}
          uploads={uploads}
          setUploads={setUploads}
          fields={[
            { id: "kitchen", label: "Kitchen photos", sectionTitle: "Kitchen" },
            { id: "bedroom", label: "Bedroom photos", sectionTitle: "Bedroom" },
          ]}
        />
      </EvidenceContext.Provider>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
