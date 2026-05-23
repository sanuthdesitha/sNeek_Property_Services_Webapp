export interface CommandRoute {
  id: string;
  label: string;
  href: string;
  group: "Operations" | "People" | "Work" | "Money" | "Marketing" | "Inventory" | "System";
  keywords?: string[];
}

export const ROUTES: CommandRoute[] = [
  { id: "dashboard", label: "Dashboard", href: "/admin", group: "Operations" },
  { id: "jobs", label: "Jobs", href: "/admin/jobs", group: "Operations", keywords: ["work", "assignments"] },
  { id: "calendar", label: "Calendar", href: "/admin/calendar", group: "Operations" },
  { id: "ops-map", label: "Live Ops Map", href: "/admin/ops/map", group: "Operations", keywords: ["gps", "tracking"] },
  { id: "clients", label: "Clients", href: "/admin/clients", group: "People" },
  { id: "properties", label: "Properties", href: "/admin/properties", group: "People" },
  { id: "workforce", label: "Workforce", href: "/admin/workforce", group: "People", keywords: ["staff", "team"] },
  { id: "qa", label: "QA", href: "/admin/qa", group: "Work" },
  { id: "cases", label: "Cases", href: "/admin/cases", group: "Work" },
  { id: "approvals", label: "Approvals", href: "/admin/approvals", group: "Work" },
  { id: "time-adjustments", label: "Time Adjustments", href: "/admin/time-adjustments", group: "Work" },
  { id: "quotes", label: "Quotes", href: "/admin/quotes", group: "Money" },
  { id: "invoices", label: "Invoices", href: "/admin/invoices", group: "Money" },
  { id: "finance", label: "Finance", href: "/admin/finance", group: "Money" },
  { id: "payroll", label: "Payroll", href: "/admin/payroll", group: "Money" },
  { id: "website", label: "Website", href: "/admin/website", group: "Marketing", keywords: ["cms", "blog"] },
  { id: "marketing", label: "Marketing Campaigns", href: "/admin/marketing", group: "Marketing" },
  { id: "inventory", label: "Inventory", href: "/admin/inventory", group: "Inventory" },
  { id: "stock-runs", label: "Stock Runs", href: "/admin/stock-runs", group: "Inventory" },
  { id: "shopping-runs", label: "Shopping Runs", href: "/admin/shopping-runs", group: "Inventory" },
  { id: "suppliers", label: "Suppliers", href: "/admin/suppliers", group: "Inventory" },
  { id: "laundry", label: "Laundry", href: "/admin/laundry", group: "Inventory" },
  { id: "integrations", label: "Integrations", href: "/admin/integrations", group: "System" },
  { id: "users", label: "Users", href: "/admin/users", group: "System" },
  { id: "settings", label: "Settings", href: "/admin/settings", group: "System" },
];
