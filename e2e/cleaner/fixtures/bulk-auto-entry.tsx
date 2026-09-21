import React from "react";
import { createRoot } from "react-dom/client";
import { BulkPhotoAssign } from "@/components/v2/cleaner/bulk-photo-assign";
import { EvidenceContext } from "@/components/v2/cleaner/evidence-context";
import type { CapturedMedia } from "@/components/v2/cleaner/media-capture";
import type { UploadMap } from "@/components/v2/cleaner/form-renderer";
function Fixture() {
  const [pool, setPool] = React.useState<CapturedMedia[]>([]), [uploads, setUploads] = React.useState<UploadMap>({});
  return <div data-skin="estate"><EvidenceContext.Provider value={{ jobId: "job", templateId: "template", formRevision: "revision", draftIdentity: "actor" }}>
    <BulkPhotoAssign open onClose={() => {}} pool={pool} setPool={setPool} uploads={uploads} setUploads={setUploads} fields={[{ id: "kitchen", label: "Kitchen bench and appliance photos", sectionTitle: "Kitchen" }]} prepareAutoAssign={async () => {}} />
  </EvidenceContext.Provider></div>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
