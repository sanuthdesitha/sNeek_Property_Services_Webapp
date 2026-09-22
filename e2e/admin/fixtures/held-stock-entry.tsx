import React from "react";
import { createRoot } from "react-dom/client";
import { EstateOnHand } from "@/components/v2/admin/inventory/estate-on-hand";
createRoot(document.getElementById("root")!).render(<div data-skin="estate" style={{ padding: 16 }}><EstateOnHand /></div>);
