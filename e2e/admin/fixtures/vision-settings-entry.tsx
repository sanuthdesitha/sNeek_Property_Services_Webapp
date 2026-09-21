import * as React from "react";
import { createRoot } from "react-dom/client";
import { VisionSettingsPanel } from "../../../components/v2/admin/vision-settings";
import { DEFAULT_VISION_SETTINGS } from "../../../lib/ai/vision-settings-schema";
const root = createRoot(document.getElementById("root")!);
(window as any).__mountVision = (canEdit: boolean) => root.render(<VisionSettingsPanel initialSettings={DEFAULT_VISION_SETTINGS} configured canEdit={canEdit} />);
