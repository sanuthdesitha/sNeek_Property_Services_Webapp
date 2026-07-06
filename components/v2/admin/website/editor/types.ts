import type { Dispatch, SetStateAction } from "react";
import type { WebsiteContent } from "@/lib/public-site/content";

/** Props threaded into every Estate website-CMS section editor. */
export interface SectionProps {
  content: WebsiteContent;
  setContent: Dispatch<SetStateAction<WebsiteContent>>;
  readOnly: boolean;
  uploadingKey: string | null;
  handleUpload: (key: string, file: File, apply: (url: string) => void) => Promise<void>;
}
