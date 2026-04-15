"use client";

import { cn } from "@/lib/utils";
import { useState } from "react";
import {
  LayoutDashboard,
  Briefcase,
  Building2,
  Users,
  Package,
  Shirt,
  FileText,
  ShoppingCart,
  ClipboardList,
  Truck,
  BarChart3,
  Settings,
  Plug,
  Megaphone,
  Globe,
  Calendar,
  FormInput,
  MessageSquare,
  Bell,
  UserCog,
  MapPin,
  Brain,
  Scale,
  UserCircle,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  LogOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOut } from "next-auth/react";

interface NavSection {
  label: string;
  items: NavItem[];
}

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_SECTIONS: NavSection[] = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
      { label: "Calendar", href: "/admin/calendar", icon: Calendar },
      { label: "Ops Map", href: "/admin/ops/map", icon: MapPin },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Jobs", href: "/admin/jobs", icon: Briefcase },
      { label: "Properties", href: "/admin/properties", icon: Building2 },
      { label: "Clients", href: "/admin/clients", icon: Users },
      { label: "Onboarding", href: "/admin/onboarding", icon: UserCog },
      { label: "Quotes", href: "/admin/quotes", icon: FileText },
      { label: "Forms", href: "/admin/forms", icon: FormInput },
    ],
  },
  {
    label: "Inventory & Supplies",
    items: [
      { label: "Inventory", href: "/admin/inventory", icon: Package },
      { label: "Shopping Runs", href: "/admin/shopping-runs", icon: ShoppingCart },
      { label: "Stock Runs", href: "/admin/stock-runs", icon: ClipboardList },
      { label: "Suppliers", href: "/admin/suppliers", icon: Truck },
    ],
  },
  {
    label: "Laundry",
    items: [
      { label: "Tasks", href: "/admin/laundry", icon: Shirt },
      { label: "Suppliers", href: "/admin/laundry/suppliers", icon: Truck },
    ],
  },
  {
    label: "Finance",
    items: [
      { label: "Dashboard", href: "/admin/finance/dashboard", icon: BarChart3 },
      { label: "Invoices", href: "/admin/invoices", icon: FileText },
      { label: "Payroll", href: "/admin/payroll", icon: Scale },
      { label: "Pay Adjustments", href: "/admin/pay-adjustments", icon: Scale },
      { label: "Time Adjustments", href: "/admin/time-adjustments", icon: Scale },
    ],
  },
  {
    label: "Reports & Cases",
    items: [
      { label: "Reports", href: "/admin/reports", icon: BarChart3 },
      { label: "Cases", href: "/admin/cases", icon: MessageSquare },
      { label: "Approvals", href: "/admin/approvals", icon: ClipboardList },
    ],
  },
  {
    label: "Team & Comms",
    items: [
      { label: "Users", href: "/admin/users", icon: Users },
      { label: "Workforce", href: "/admin/workforce", icon: UserCog },
      { label: "Messages", href: "/admin/messages", icon: MessageSquare },
      { label: "Notifications", href: "/admin/notifications", icon: Bell },
    ],
  },
  {
    label: "Marketing & Web",
    items: [
      { label: "Campaigns", href: "/admin/marketing", icon: Megaphone },
      { label: "Website", href: "/admin/website", icon: Globe },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Intelligence", href: "/admin/intelligence", icon: Brain },
      { label: "Scale", href: "/admin/scale", icon: Scale },
      { label: "Integrations", href: "/admin/integrations", icon: Plug },
      { label: "Settings", href: "/admin/settings", icon: Settings },
      { label: "Profile", href: "/admin/profile", icon: UserCircle },
    ],
  },
];

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen flex bg-neutral-50 dark:bg-neutral-950">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed lg:sticky top-0 left-0 z-50 lg:z-auto h-screen flex flex-col bg-surface-elevated border-r border-border transition-all duration-300",
          collapsed ? "lg:w-16" : "lg:w-64",
          mobileOpen ? "w-64 translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 h-14 px-4 border-b border-border">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 shrink-0">
            <span className="text-sm font-bold text-white">S</span>
          </div>
          {!collapsed && (
            <span className="font-semibold text-text-primary truncate">sNeek Ops</span>
          )}
          <button
            className="ml-auto lg:hidden"
            onClick={() => setMobileOpen(false)}
          >
            <X className="h-5 w-5 text-text-secondary" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-6">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label}>
              {!collapsed && (
                <p className="px-2 mb-1 text-xs font-medium text-text-tertiary uppercase tracking-wider">
                  {section.label}
                </p>
              )}
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.href}>
                    <a
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors",
                        "text-text-secondary hover:bg-neutral-100 hover:text-text-primary dark:hover:bg-neutral-800",
                        collapsed && "justify-center px-2",
                      )}
                      title={collapsed ? item.label : undefined}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-border p-2">
          <Button
            variant="ghost"
            size="sm"
            className={cn("w-full justify-start gap-2", collapsed && "justify-center px-2")}
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            <LogOut className="h-4 w-4" />
            {!collapsed && <span>Sign out</span>}
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-30 h-14 flex items-center gap-3 px-4 bg-surface-elevated/80 backdrop-blur border-b border-border">
          <button
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="h-5 w-5 text-text-secondary" />
          </button>
          <button
            className="hidden lg:flex"
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4 text-text-secondary" />
            ) : (
              <ChevronLeft className="h-4 w-4 text-text-secondary" />
            )}
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-secondary">Admin</span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-6 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
