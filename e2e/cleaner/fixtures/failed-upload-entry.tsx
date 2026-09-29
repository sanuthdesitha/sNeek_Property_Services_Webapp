import React from "react";
import {createRoot} from "react-dom/client";
import {MediaCapture,type CapturedMedia} from "@/components/v2/cleaner/media-capture";
function Fixture(){const [value,setValue]=React.useState<CapturedMedia[]>([{key:"saved.pdf",url:"/saved.pdf",kind:"file",name:"Already uploaded.pdf"}]);return <div data-skin="estate" style={{padding:16,fontFamily:"Arial,sans-serif"}}><h1>Job evidence</h1><MediaCapture value={value} onChange={setValue} mode="file" multiple/><output data-testid="attachments">{value.length}</output></div>;}
createRoot(document.getElementById("root")!).render(<Fixture/>);
