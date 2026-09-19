import React from "react";
import { createRoot } from "react-dom/client";
import { JobChatSheet } from "@/components/v2/client/job-chat";
function Fixture() {
  const [open, setOpen] = React.useState(false);
  return <><button onClick={() => setOpen(true)}>Open clean conversation</button><button>Outside control</button><JobChatSheet jobId="chat-job" jobLabel="Synthetic clean" open={open} onClose={() => setOpen(false)} /></>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
