import React from "react";
import { createRoot } from "react-dom/client";
import { MediaCapture, type CapturedMedia } from "@/components/v2/cleaner/media-capture";
import { EvidenceContext } from "@/components/v2/cleaner/evidence-context";
const scope = { jobId: "job", draftIdentity: "cleaner", templateId: "template", formRevision: "a".repeat(64) };
function Fixture() {
 const [value, setValue] = React.useState<CapturedMedia[]>([]);
 return <EvidenceContext.Provider value={scope}><div data-skin="estate" data-portal-accent="cleaner" className="estate-root min-h-screen bg-[hsl(var(--e-background))] text-[hsl(var(--e-foreground))] p-4" style={{fontFamily:"Arial,sans-serif"}}>
 <h1>Job video evidence</h1><MediaCapture value={value} onChange={setValue} mode="both" evidenceFieldId="walkthrough" multiple/>
 <output data-testid="attachments">{value.length}</output>
 </div></EvidenceContext.Provider>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
