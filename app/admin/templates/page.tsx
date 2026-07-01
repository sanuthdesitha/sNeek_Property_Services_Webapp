import { redirect } from "next/navigation";

// The Templates hub is retired — each template type now lives as a settings
// section under its relevant page: Forms & checklists under /admin/forms, Email
// & SMS under /admin/notifications, Report themes under /admin/reports/themes.
export default function TemplatesHubRedirect() {
  redirect("/admin/forms");
}
