import React from "react";
import {createRoot} from "react-dom/client";
import {OllamaSection} from "@/components/v2/admin/settings/ollama-section";
createRoot(document.getElementById("root")!).render(<main data-skin="estate" style={{padding:16,maxWidth:1100,margin:"auto"}}><OllamaSection /></main>);
