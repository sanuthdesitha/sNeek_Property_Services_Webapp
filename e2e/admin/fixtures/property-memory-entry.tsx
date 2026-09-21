import React from "react";
import { createRoot } from "react-dom/client";
import { PropertyPhotoMemoryPanel } from "@/components/v2/admin/property-photo-memory";
createRoot(document.getElementById("root")!).render(<div data-skin="estate" style={{ padding: 16 }}><PropertyPhotoMemoryPanel canEdit /></div>);
