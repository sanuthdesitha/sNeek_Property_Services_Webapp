import React from "react";
import { createRoot } from "react-dom/client";
import { MediaCapture, type CapturedMedia } from "@/components/v2/cleaner/media-capture";
function Fixture() {
  const [media, setMedia] = React.useState<CapturedMedia[]>([]);
  return <><h1>Capture verification</h1><MediaCapture value={media} onChange={setMedia} mode="photo" stamp={null}/><output data-testid="attached">{media.length}</output></>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
