import React from "react";
import { createRoot } from "react-dom/client";
import { SocialManager } from "../../../components/v2/admin/marketing/social-manager";
createRoot(document.getElementById("root")!).render(<SocialManager initialPosts={[]} onToast={() => {}} />);
