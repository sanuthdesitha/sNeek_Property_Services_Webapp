import React from "react";
import { createRoot } from "react-dom/client";
import { EstateInvoices } from "@/components/v2/admin/finance/estate-invoices";
import { Toaster } from "@/components/ui/toaster";
createRoot(document.getElementById("root")!).render(<><EstateInvoices /><Toaster /></>);
