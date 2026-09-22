import React from "react";
import { createRoot } from "react-dom/client";
import { ShoppingRunWorkspace } from "../../../components/v2/cleaner/shopping-run-workspace";
(window as any).__mountShopping = () => createRoot(document.getElementById("root")!).render(<ShoppingRunWorkspace apiBase="/api/cleaner/inventory/shopping-runs" runId="run" backHref="/v2/cleaner/shopping" backLabel="Shopping" title="Shopping run" />);
