import React from "react";
import { createRoot } from "react-dom/client";
import { PurchasesFeed } from "@/components/v2/client/shopping/purchases-feed";
createRoot(document.getElementById("root")!).render(<div data-skin="estate" style={{ padding: 16 }}><PurchasesFeed /></div>);
