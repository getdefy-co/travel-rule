"use client";

import { AppShell } from "@/components/app-shell";
import { ResourceDashboard } from "@/components/resource-dashboard";

export default function Page() {
  return <AppShell requiredRoles={["auditor", "integration_operator", "platform_admin"]}><ResourceDashboard resource="events" /></AppShell>;
}
