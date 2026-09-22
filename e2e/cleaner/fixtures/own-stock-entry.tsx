import React from "react";
import { createRoot } from "react-dom/client";
import { OnHandView } from "@/components/v2/cleaner/on-hand-view";
createRoot(document.getElementById("root")!).render(<div data-skin="estate" style={{ padding: 16 }}><OnHandView properties={[{ id: "property", name: "Harbour apartment", suburb: "Sydney" }]} /></div>);
