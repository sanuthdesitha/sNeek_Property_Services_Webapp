import React from "react";
import { createRoot } from "react-dom/client";
import { JobOfferActions } from "@/components/v2/cleaner/job-offer-actions";
createRoot(document.getElementById("root")!).render(<JobOfferActions jobId="synthetic-offer"/>);
