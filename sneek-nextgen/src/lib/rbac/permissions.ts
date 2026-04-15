export const ROLE_HIERARCHY: Record<string, number> = {
  ADMIN: 100,
  OPS_MANAGER: 80,
  CLEANER: 40,
  CLIENT: 20,
  LAUNDRY: 10,
};

export const PERMISSIONS: Record<string, string[]> = {
  ADMIN: [
    "manage_users", "manage_clients", "manage_properties", "manage_jobs",
    "manage_inventory", "manage_laundry", "manage_quotes", "manage_leads",
    "manage_finance", "manage_payroll", "manage_invoices", "manage_reports",
    "manage_forms", "manage_settings", "manage_integrations", "manage_marketing",
    "manage_workforce", "manage_notifications", "manage_cases", "manage_approvals",
    "manage_chat", "manage_calendar", "manage_delivery_profiles", "manage_onboarding",
    "view_intelligence", "view_scale", "view_ops_map", "manage_website",
    "manage_subscriptions", "manage_email_campaigns", "manage_message_templates",
    "manage_learning_paths", "manage_staff_documents", "manage_staff_recognition",
    "manage_hiring", "manage_live_locations", "manage_job_continuations",
    "manage_job_early_checkouts", "manage_job_tasks",
  ],
  OPS_MANAGER: [
    "manage_clients", "manage_properties", "manage_jobs", "manage_inventory",
    "manage_laundry", "manage_quotes", "manage_reports", "manage_forms",
    "manage_cases", "manage_approvals", "manage_chat", "manage_calendar",
    "view_finance", "view_payroll", "view_notifications", "view_intelligence",
    "view_ops_map", "manage_job_continuations", "manage_job_early_checkouts",
    "manage_job_tasks", "manage_onboarding",
  ],
  CLEANER: [
    "view_own_jobs", "update_own_jobs", "view_own_route", "view_own_calendar",
    "view_own_invoices", "submit_pay_requests", "view_own_shopping",
    "submit_shopping_runs", "submit_stock_runs", "manage_own_availability",
    "view_own_profile", "view_own_settings", "view_hub", "submit_lost_found",
    "view_own_pay_adjustments",
  ],
  CLIENT: [
    "view_own_properties", "view_own_jobs", "request_tasks", "request_reschedule",
    "request_cancel", "view_own_reports", "view_own_finance", "pay_invoices",
    "view_own_approvals", "create_disputes", "manage_own_cases",
    "view_own_inventory", "view_own_shopping", "view_own_stock_runs",
    "view_own_laundry", "send_messages", "view_referrals", "view_own_profile",
    "view_own_settings", "request_quote", "book_jobs",
  ],
  LAUNDRY: [
    "view_laundry_tasks", "update_laundry_status", "view_laundry_calendar",
    "view_laundry_invoices", "view_laundry_profile", "view_laundry_settings",
  ],
};

export function hasPermission(role: string, permission: string): boolean {
  const perms = PERMISSIONS[role];
  if (!perms) return false;
  return perms.includes(permission);
}

export function hasRoleLevel(userRole: string, requiredRole: string): boolean {
  return (ROLE_HIERARCHY[userRole] ?? 0) >= (ROLE_HIERARCHY[requiredRole] ?? 0);
}
