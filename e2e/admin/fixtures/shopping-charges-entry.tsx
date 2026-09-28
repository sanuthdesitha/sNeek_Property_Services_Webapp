import React from "react";
import { createRoot } from "react-dom/client";
import { ShoppingClientCharges } from "@/components/v2/admin/inventory/shopping-client-charges";
createRoot(document.getElementById("root")!).render(<main data-skin="estate" style={{padding:16,maxWidth:1000,margin:"auto"}}><ShoppingClientCharges runId="run" /></main>);
