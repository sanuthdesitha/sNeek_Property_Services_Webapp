import React from "react";
import { createRoot } from "react-dom/client";
import { DraftEvidenceReview } from "@/components/v2/admin/jobs/draft-evidence-review";
import { BulkPhotoAssign } from "@/components/v2/cleaner/bulk-photo-assign";
import { EvidenceContext } from "@/components/v2/cleaner/evidence-context";
import type { CapturedMedia } from "@/components/v2/cleaner/media-capture";
const key = "forms/old-job/capture/cleaner/photo.jpg";
function Fixture() {
  const [pool, setPool] = React.useState<CapturedMedia[]>([{ key, name: "Old photo", kind: "image", url: "/fixture.svg" }]);
  const [uploads, setUploads] = React.useState({});
  return <div data-skin="estate" className="min-h-screen p-3">{location.pathname.includes("office") ? <DraftEvidenceReview jobId="job" /> : <EvidenceContext.Provider value={{ jobId: "job", templateId: "template", formRevision: "current", draftIdentity: "actor" }}><BulkPhotoAssign open onClose={() => {}} pool={pool} setPool={setPool} uploads={uploads} setUploads={setUploads} fields={[]} /></EvidenceContext.Provider>}</div>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
