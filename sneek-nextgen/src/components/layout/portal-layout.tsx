"use client";

import { cn } from "@/lib/utils";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { signOut } from "next-auth/react";
import {
  LayoutDashboard,
  Briefcase,
  Route,
  Calendar,
  FileText,
  Scale,
  Package,
  ClipboardList,
  Shirt,
  MessageSquare,
  UserCircle,
  Settings,
  Menu,
  X,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Home,
  MapPin,
  Star,
  Bell,
} from "lucide-react";

interface PortalConfig {
  name: string;
  sections: { label: string; items: { label: string; href: string; icon: React.ComponentType<{ className?: string }> }[] }[];
}

const PORTAL_CONFIGS: Record<string, PortalConfig> = {
  cleaner: {
    name: "Cleaner Portal",
    sections: [
      {
        label: "Overview",
        items: [
          { label: "Dashboard", href: "/cleaner", icon: LayoutDashboard },
          { label: "Today's Route", href: "/cleaner/route", icon: Route },
          { label: "Calendar", href: "/cleaner/calendar", icon: Calendar },
        ],
      },
      {
        label: "Work",
        items: [
          { label: "My Jobs", href: "/cleaner/jobs", icon: Briefcase },
          { label: "Shopping", href: "/cleaner/shopping", icon: Package },
          { label: "Stock Runs", href: "/cleaner/stock-runs", icon: ClipboardList },
          { label: "Lost & Found", href: "/cleaner/lost-found", icon: MapPin },
        ],
      },
      {
        label: "Pay & Profile",
        items: [
          { label: "Pay Requests", href: "/cleaner/pay-requests", icon: Scale },
          { label: "Invoices", href: "/cleaner/invoices", icon: FileText },
          { label: "Availability", href: "/cleaner/availability", icon: Calendar },
          { label: "Profile", href: "/cleaner/profile", icon: UserCircle },
          { label: "Settings", href: "/cleaner/settings", icon: Settings },
        ],
      },
      {
        label: "Team",
        items: [
          { label: "Hub", href: "/cleaner/hub", icon: Home },
          { label: "Messages", href: "/cleaner/messages", icon: MessageSquare },
        ],
      },
    ],
  },
  client: {
    name: "Client Portal",
    sections: [
      {
        label: "Overview",
        items: [
          { label: "Dashboard", href: "/client", icon: LayoutDashboard },
          { label: "Calendar", href: "/client/calendar", icon: Calendar },
        ],
      },
      {
        label: "Services",
        items: [
          { label: "My Jobs", href: "/client/jobs", icon: Briefcase },
          { label: "Properties", href: "/client/properties", icon: Home },
          { label: "Book a Clean", href: "/client/booking", icon: Star },
          { label: "Request a Quote", href: "/client/quote", icon: FileText },
        ],
      },
      {
        label: "Management",
        items: [
          { label: "Approvals", href: "/client/approvals", icon: ClipboardList },
          { label: "Cases", href: "/client/cases", icon: MessageSquare },
          { label: "Disputes", href: "/client/disputes", icon: Bell },
          { label: "Reports", href: "/client/reports", icon: FileText },
        ],
      },
      {
        label: "Finance",
        items: [
          { label: "Finance", href: "/client/finance", icon: Scale },
          { label: "Invoices", href: "/client/invoices", icon: FileText },
          { label: "Referrals", href: "/client/referrals", icon: Star },
        ],
      },
      {
        label: "Inventory & Laundry",
        items: [
          { label: "Inventory", href: "/client/inventory", icon: Package },
          { label: "Shopping", href: "/client/shopping", icon: Package },
          { label: "Stock Runs", href: "/client/stock-runs", icon: ClipboardList },
          { label: "Laundry", href: "/client/laundry", icon: Shirt },
        ],
      },
      {
        label: "Account",
        items: [
          { label: "Messages", href: "/client/messages", icon: MessageSquare },
          { label: "Profile", href: "/client/profile", icon: UserCircle },
          { label: "Settings", href: "/client/settings", icon: Settings },
        ],
      },
    ],
  },
  laundry: {
    name: "Laundry Portal",
    sections: [
      {
        label: "Overview",
        items: [
          { label: "Dashboard", href: "/laundry", icon: LayoutDashboard },
          { label: "Calendar", href: "/laundry/calendar", icon: Calendar },
        ],
      },
      {
        label: "Work",
        items: [
          { label: "Tasks", href: "/laundry/hub", icon: ClipboardList },
          { label: "Invoices", href: "/laundry/invoices", icon: FileText },
        ],
      },
      {
        label: "Account",
        items: [
          { label: "Profile", href: "/laundry/profile", icon: UserCircle },
          { label: "Settings", href: "/laundry/settings", icon: Settings },
        ],
      },
    ],
  },
};

export function PortalLayout({
  portal,
  children,
}: {
  portal: "cleaner" | "client" | "laundry";
  children: React.ReactNode;
}) {
  const config = PORTAL_CONFIGS[portal];
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen flex bg-neutral-50 dark:bg-neutral-950">
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={cn(
          "fixed lg:sticky top-0 left-0 z-50 lg:z-auto h-screen flex flex-col bg-surface-elevated border-r border-border transition-all duration-300",
          collapsed ? "lg:w-16" : "lg:w-64",
          mobileOpen ? "w-64 translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        <div className="flex items-center gap-3 h-14 px-4 border-b border-border">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 shrink-0">
            <span className="text-sm font-bold text-white">S</span>
          </div>
          {!collapsed && (
            <span className="font-semibold text-text-primary truncate">{config.name}</span>
          )}
          <button className="ml-auto lg:hidden" onClick={() => setMobileOpen(false)}>
            <X className="h-5 w-5 text-text-secondary" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-6">
          {config.sections.map((section) => (
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

      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 h-14 flex items-center gap-3 px-4 bg-surface-elevated/80 backdrop-blur border-b border-border">
          <button className="lg:hidden" onClick={() => setMobileOpen(true)}>
            <Menu className="h-5 w-5 text-text-secondary" />
          </button>
          <button className="hidden lg:flex" onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? (
              <ChevronRight className="h-4 w-4 text-text-secondary" />
            ) : (
              <ChevronLeft className="h-4 w-4 text-text-secondary" />
            )}
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-secondary capitalize">{portal}</span>
          </div>
        </header>
        <main className="flex-1 p-6 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
