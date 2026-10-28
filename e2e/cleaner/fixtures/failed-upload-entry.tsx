import React from "react";
import {createRoot} from "react-dom/client";
import {MediaCapture,type CapturedMedia} from "@/components/v2/cleaner/media-capture";
import {EvidenceContext} from "@/components/v2/cleaner/evidence-context";
const durable = new URLSearchParams(location.search).has("durable");
const scope = {jobId:"fixture-job",draftIdentity:"fixture-cleaner",templateId:"fixture-form",formRevision:"fixture-revision"};
function Fixture(){const [value,setValue]=React.useState<CapturedMedia[]>([{key:"saved.pdf",url:"/saved.pdf",kind:"file",name:"Already uploaded.pdf"}]);return <EvidenceContext.Provider value={durable ? scope : undefined}><div data-skin="estate" style={{padding:16,fontFamily:"Arial,sans-serif"}}><h1>Job evidence</h1><MediaCapture value={value} onChange={setValue} mode="file" multiple evidenceFieldId={durable ? "proof" : undefined}/><output data-testid="attachments">{value.length}</output></div></EvidenceContext.Provider>;}
createRoot(document.getElementById("root")!).render(<Fixture/>);
