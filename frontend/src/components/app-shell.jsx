"use client";

import { AppSidebar } from "@/components/app-sidebar";
import ProtectedRoute from "@/components/protected-route";
import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export function AppShell({ children, requiredRole, requiredRoles }) {
  return (
    <ProtectedRoute redirectTo="/login" requiredRole={requiredRole} requiredRoles={requiredRoles} unauthorizedRedirectTo="/">
      <SidebarProvider
        style={{
          "--sidebar-width": "calc(var(--spacing) * 64)",
          "--header-height": "calc(var(--spacing) * 12)",
        }}
      >
        <AppSidebar variant="inset" />
        <SidebarInset>
          <SiteHeader />
          <div className="flex min-h-[calc(100svh-var(--header-height))] flex-1 flex-col overflow-x-hidden">
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </ProtectedRoute>
  );
}
