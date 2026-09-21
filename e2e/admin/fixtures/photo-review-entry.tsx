import * as React from "react";
import { createRoot } from "react-dom/client";
import { PhotoReviewPanel } from "../../../components/v2/qa/photo-review-panel";
createRoot(document.getElementById("root")!).render(<PhotoReviewPanel jobId="synthetic-job" />);
